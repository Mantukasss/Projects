-- Move the push functions into `public`, where PostgREST can already see them.
--
-- WHY: exposing a whole schema to the API needs a PostgREST config change, which on Supabase
-- takes a service restart to apply — and it widens the API surface for no benefit. `public`
-- is already exposed, so putting four narrow, secret-guarded functions there is both smaller
-- and immediate.
--
-- THE TABLES DO NOT MOVE. They stay in `newsdesk` with RLS on and no policies, unreachable
-- to anon by any route. Only these functions can touch them, and they run as their owner.
-- Naming keeps the prefix so `public` does not turn into a junk drawer.

create or replace function public.newsdesk_subscribe_push(
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

create or replace function public.newsdesk_unsubscribe_push(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = newsdesk, pg_temp
as $$
begin
  delete from newsdesk.push_subscriptions where endpoint = p_endpoint;
end $$;

-- Claim a batch of stories and hand back the devices to notify.
--
-- The claim IS the insert: `on conflict do nothing ... returning` means two ticks racing each
-- other cannot both win the same story. Read-then-write would double-push whenever two
-- dispatches overlapped, and on a one-minute timer that is a matter of when, not if.
create or replace function public.newsdesk_claim_push(
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

  if array_length(v_new, 1) is null then
    return json_build_object('new_ids', '[]'::json, 'subscriptions', '[]'::json);
  end if;

  select coalesce(json_agg(json_build_object(
           'endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)), '[]'::json)
    into v_subs
    from newsdesk.push_subscriptions
   where failures < 5;

  -- Housekeeping rides along rather than needing a second cron entry.
  delete from newsdesk.pushed_items where pushed_at < now() - interval '7 days';

  return json_build_object('new_ids', to_json(v_new), 'subscriptions', v_subs);
end $$;

create or replace function public.newsdesk_record_push_result(
  p_secret   text,
  p_endpoint text,
  p_ok       boolean,
  p_gone     boolean
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
    -- 404/410 from the push service is definitive: that subscription is dead for good.
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

grant execute on function public.newsdesk_subscribe_push(text, text, text)   to anon, authenticated;
grant execute on function public.newsdesk_unsubscribe_push(text)             to anon, authenticated;
grant execute on function public.newsdesk_claim_push(text, text[])           to anon, authenticated;
grant execute on function public.newsdesk_record_push_result(text, text, boolean, boolean) to anon, authenticated;

-- The originals in `newsdesk` are dropped: two copies of a security-sensitive function is an
-- invitation for one of them to be fixed and the other forgotten.
drop function if exists newsdesk.subscribe_push(text, text, text);
drop function if exists newsdesk.unsubscribe_push(text);
drop function if exists newsdesk.claim_push(text, text[]);
drop function if exists newsdesk.record_push_result(text, text, boolean, boolean);
