-- Web push for newsdesk: device registrations, a record of what has already been pushed,
-- and the minute-level timer that drives it.
--
-- WHY THIS EXISTS: the feed is pull-based, so a story announced at 13:35 sits unread until
-- someone opens the app. On the day that mattered, an org announced a contract renewal and
-- the story was public for eleven minutes before the fastest account in the niche posted it.
-- Being first is worth nothing if nobody is looking.
--
-- WHY pg_cron AND NOT VERCEL CRON: Vercel's Hobby plan caps scheduled functions at ONCE PER
-- DAY. pg_cron runs inside this database, is free, and goes down to one minute. pg_net makes
-- the outbound call. Neither costs anything and neither is a new service.
--
-- ---------------------------------------------------------------------------------------
-- ON IRON RULE #4 (RLS keyed to auth.uid()), WHICH THIS DELIBERATELY DOES NOT FOLLOW
-- ---------------------------------------------------------------------------------------
-- The rule says every user-data table carries `user_id uuid references auth.users not null`
-- and gates rows on `auth.uid()`. Newsdesk has NO AUTH — it is a single-owner console with
-- no sign-in — so there is no `auth.uid()` to gate on, and adding a column referencing
-- auth.users that is always null would fail the not-null constraint and mean nothing.
--
-- What is done instead is STRICTER than the rule, not looser: RLS is enabled on every table
-- and NO POLICY IS CREATED, so the anon and authenticated roles can read and write NOTHING,
-- ever, directly. Every access goes through a SECURITY DEFINER function with a narrow
-- signature, and the one that can read device registrations demands a shared secret.
--
-- This also means the service_role key is NEVER needed by the app, which keeps the other
-- rule intact: that key stays in the owner's password manager and never reaches Vercel.
--
-- If newsdesk ever gains Google sign-in, add `user_id uuid references auth.users` to
-- push_subscriptions and a policy alongside these functions. Additive, per rule #2.

create schema if not exists newsdesk;

-- ---------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------

-- One row per browser that asked for alerts. The endpoint IS the identity — it is the URL
-- the push service hands out, unique per device per app, and it is the primary key so a
-- re-subscribe updates in place instead of stacking duplicates.
create table if not exists newsdesk.push_subscriptions (
  endpoint    text primary key,
  p256dh      text        not null,
  auth        text        not null,
  created_at  timestamptz not null default now(),
  last_sent_at timestamptz,
  -- A push service answers 404/410 once a subscription is dead. Counting failures lets a
  -- dead device stop costing a request on every tick without deleting it on one bad night.
  failures    integer     not null default 0
);
alter table newsdesk.push_subscriptions enable row level security;

-- What has already been pushed, so a story is announced once and not once a minute for an
-- hour. The feed's own item ids are stable per story, which is what makes this work.
create table if not exists newsdesk.pushed_items (
  item_id   text primary key,
  pushed_at timestamptz not null default now()
);
alter table newsdesk.pushed_items enable row level security;

-- The shared secret, stored rather than hardcoded so it can be rotated without a migration.
create table if not exists newsdesk.push_config (
  id     integer primary key default 1 check (id = 1),
  secret text not null
);
alter table newsdesk.push_config enable row level security;

-- ---------------------------------------------------------------------------------------
-- Functions — the only way in
-- ---------------------------------------------------------------------------------------

-- Register this device. Open to anon on purpose: asking for alerts on your own browser is
-- the entire point, and the endpoint is issued by the push service, not chosen by a caller.
create or replace function newsdesk.subscribe_push(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text
) returns void
language plpgsql
security definer
set search_path = newsdesk, pg_temp
as $$
begin
  if p_endpoint is null or p_endpoint = '' then
    raise exception 'endpoint required';
  end if;
  insert into newsdesk.push_subscriptions (endpoint, p256dh, auth)
  values (p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth   = excluded.auth,
        -- A device that re-subscribes is alive again, whatever it did before.
        failures = 0;
end $$;

-- Forget this device. Also open to anon: turning your own alerts off must always work.
create or replace function newsdesk.unsubscribe_push(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = newsdesk, pg_temp
as $$
begin
  delete from newsdesk.push_subscriptions where endpoint = p_endpoint;
end $$;

-- Claim a batch of candidate stories and hand back the devices to notify.
--
-- One round trip, and the claim is the INSERT itself: `on conflict do nothing ... returning`
-- means two ticks racing each other cannot both win the same story. Doing this as a read
-- then a write would push twice whenever two dispatches overlapped, which on a one-minute
-- timer is a matter of when, not if.
create or replace function newsdesk.claim_push(
  p_secret   text,
  p_item_ids text[]
) returns json
language plpgsql
security definer
set search_path = newsdesk, pg_temp
as $$
declare
  v_expected text;
  v_new      text[];
  v_subs     json;
begin
  select secret into v_expected from newsdesk.push_config where id = 1;
  -- Constant-time-ish compare via digest equality is overkill for a bearer secret that also
  -- guards the HTTP route; a plain mismatch raise is enough and keeps this readable.
  if v_expected is null or p_secret is distinct from v_expected then
    raise exception 'unauthorised' using errcode = '28000';
  end if;

  with claimed as (
    insert into newsdesk.pushed_items (item_id)
    select distinct unnest(p_item_ids)
    on conflict (item_id) do nothing
    returning item_id
  )
  select coalesce(array_agg(item_id), '{}') into v_new from claimed;

  -- Nothing new means nothing to send, so do not bother listing devices.
  if array_length(v_new, 1) is null then
    return json_build_object('new_ids', '[]'::json, 'subscriptions', '[]'::json);
  end if;

  select coalesce(json_agg(json_build_object(
           'endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)), '[]'::json)
    into v_subs
    from newsdesk.push_subscriptions
   where failures < 5;

  -- Housekeeping rides along rather than needing a second cron entry. A story older than a
  -- week can never be "new" again, and the table would otherwise grow without limit.
  delete from newsdesk.pushed_items where pushed_at < now() - interval '7 days';

  return json_build_object('new_ids', to_json(v_new), 'subscriptions', v_subs);
end $$;

-- Record how each device fared, so a dead endpoint stops costing a request every minute.
create or replace function newsdesk.record_push_result(
  p_secret    text,
  p_endpoint  text,
  p_ok        boolean,
  p_gone      boolean
) returns void
language plpgsql
security definer
set search_path = newsdesk, pg_temp
as $$
declare v_expected text;
begin
  select secret into v_expected from newsdesk.push_config where id = 1;
  if v_expected is null or p_secret is distinct from v_expected then
    raise exception 'unauthorised' using errcode = '28000';
  end if;

  if p_gone then
    -- 404/410 from the push service is definitive: that subscription will never work again.
    delete from newsdesk.push_subscriptions where endpoint = p_endpoint;
  elsif p_ok then
    update newsdesk.push_subscriptions
       set last_sent_at = now(), failures = 0
     where endpoint = p_endpoint;
  else
    update newsdesk.push_subscriptions
       set failures = failures + 1
     where endpoint = p_endpoint;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- Grants — execute only, and only on the functions above
-- ---------------------------------------------------------------------------------------
grant usage on schema newsdesk to anon, authenticated;
grant execute on function newsdesk.subscribe_push(text, text, text)   to anon, authenticated;
grant execute on function newsdesk.unsubscribe_push(text)             to anon, authenticated;
grant execute on function newsdesk.claim_push(text, text[])           to anon, authenticated;
grant execute on function newsdesk.record_push_result(text, text, boolean, boolean) to anon, authenticated;
