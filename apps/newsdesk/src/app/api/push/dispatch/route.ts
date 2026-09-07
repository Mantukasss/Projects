import { NextResponse } from "next/server";
import webpush from "web-push";
import type { FeedItem } from "@/lib/types";
import { claim, hasPushBackend, hasPushKeys, recordResult } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Sends the alert. Called once a minute by pg_cron, and by nothing else.
 *
 * WHY A ROUTE AND NOT A DATABASE JOB: Web Push needs a signed VAPID JWT and per-device
 * payload encryption, which is not work Postgres should be doing. So pg_cron is a timer and
 * this is the worker. pg_net makes the call because Vercel's Hobby cron caps at once a day,
 * which is useless for news.
 *
 * WHAT IT DOES NOT DO: decide twice about the same story. The claim is an INSERT with
 * `on conflict do nothing ... returning`, so overlapping ticks cannot both win an item. A
 * read-then-write would double-push whenever two dispatches overlapped, and on a one-minute
 * timer against a feed that sometimes takes ten seconds, they will.
 */

/**
 * How good a story has to be before it is worth a buzz in someone's pocket.
 *
 * Set high on purpose. A notification that turns out not to be worth opening costs more than
 * a missed one: the first teaches you to ignore the next, and then the feature is dead. The
 * feed's own score already carries recency and source weighting, so this is a single number.
 */
const SCORE_FLOOR = 85;

/** Never wake anyone for something that happened hours ago. */
const MAX_AGE_MINUTES = 30;

/** One buzz per tick. Three at once is a spam notification with extra steps. */
const MAX_PER_TICK = 2;

function worthWaking(item: FeedItem): boolean {
  if (item.score < SCORE_FLOOR) return false;
  const ageMinutes = (Date.now() - Date.parse(item.publishedAt)) / 60_000;
  if (!Number.isFinite(ageMinutes) || ageMinutes > MAX_AGE_MINUTES) return false;
  // A post you cannot read is not a post you should be woken for; translating it is a
  // deliberate act and it can wait until the feed is open.
  if (item.foreign) return false;
  // "Somebody already posted this" is the opposite of a reason to hurry.
  if (item.scooped) return false;
  return true;
}

export async function POST(request: Request) {
  const secret = process.env.PUSH_CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "push not configured" }, { status: 501 });
  if (!hasPushBackend() || !hasPushKeys()) {
    return NextResponse.json({ error: "push not configured" }, { status: 501 });
  }

  // The same secret guards the route and the database function, so there is one thing to
  // rotate rather than two that can drift apart.
  const offered = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (offered !== secret) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  // Its own feed, through the public route, so the dispatcher and the page can never
  // disagree about what the news is.
  const origin = new URL(request.url).origin;
  let items: FeedItem[] = [];
  try {
    const res = await fetch(`${origin}/api/feed`, { cache: "no-store" });
    items = ((await res.json()) as { items?: FeedItem[] }).items ?? [];
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "feed unreachable" },
      { status: 502 },
    );
  }

  const candidates = items.filter(worthWaking).slice(0, MAX_PER_TICK * 4);
  if (candidates.length === 0) {
    return NextResponse.json({ checked: items.length, sent: 0, reason: "nothing worth it" });
  }

  const { new_ids: newIds, subscriptions } = await claim(
    secret,
    candidates.map((item) => item.id),
  );
  if (newIds.length === 0 || subscriptions.length === 0) {
    return NextResponse.json({
      checked: items.length,
      sent: 0,
      reason: newIds.length === 0 ? "all seen" : "no devices",
    });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:nobody@example.com",
    process.env.VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string,
  );

  const claimed = new Set(newIds);
  const sending = candidates.filter((item) => claimed.has(item.id)).slice(0, MAX_PER_TICK);

  let sent = 0;
  let failed = 0;
  for (const item of sending) {
    const payload = JSON.stringify({
      title: item.title.slice(0, 120),
      // The reasons line is what the card shows, so the notification says the same thing the
      // app will: who carried it and how old it is.
      body: item.reasons.slice(0, 2).join(" · ").slice(0, 160),
      itemId: item.id,
      score: item.score,
    });

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 600, urgency: "high" },
          );
          sent += 1;
          await recordResult(secret, sub.endpoint, true, false).catch(() => undefined);
        } catch (error) {
          failed += 1;
          // 404 and 410 are the push service saying this subscription is dead for good —
          // the browser was uninstalled, or the user revoked permission. Anything else is a
          // bad night and the device keeps its place until it has had five of them.
          const status = (error as { statusCode?: number }).statusCode;
          const gone = status === 404 || status === 410;
          await recordResult(secret, sub.endpoint, false, gone).catch(() => undefined);
        }
      }),
    );
  }

  return NextResponse.json({
    checked: items.length,
    stories: sending.map((item) => item.id),
    devices: subscriptions.length,
    sent,
    failed,
  });
}
