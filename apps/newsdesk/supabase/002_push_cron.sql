-- The minute-level timer that drives push alerts.
--
-- Separate from 001 on purpose: the schema is safe to re-run anywhere, this points at a
-- specific deployment URL and should be reviewed before it is applied to anything else.
--
-- WHY NOT VERCEL CRON: the Hobby plan caps scheduled functions at ONCE PER DAY. For a news
-- desk that is not a smaller version of the feature, it is a different one.
--
-- pg_cron is only a TIMER. The route it calls does the work, because Web Push needs a signed
-- VAPID JWT and per-device payload encryption and Postgres has no business doing either.

-- The secret travels in the Authorization header, read from the table rather than written
-- here, so rotating it is an UPDATE and not a re-scheduled job.
select cron.schedule(
  'newsdesk-push',
  '* * * * *',
  $job$
  select net.http_post(
    url     := 'https://mantas-newsdesk.vercel.app/api/push/dispatch',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select secret from newsdesk.push_config where id = 1)
               ),
    body    := '{}'::jsonb,
    -- Shorter than the route's own 30s ceiling: a tick that has not answered by now has been
    -- overtaken by the next one anyway, and the claim makes that harmless.
    timeout_milliseconds := 25000
  );
  $job$
);

-- pg_net keeps every response row forever, and at one request a minute that is half a
-- million rows a year on a free-tier database. Nothing reads them after the fact.
select cron.schedule(
  'newsdesk-push-gc',
  '17 4 * * *',
  $job$ delete from net._http_response where created < now() - interval '2 days'; $job$
);
