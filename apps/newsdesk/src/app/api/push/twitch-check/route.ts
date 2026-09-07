import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A one-off diagnostic: which event-channel logins resolve, and how many clips each has in
 * the window. Twitch keys live only in Vercel, so channel logins cannot be verified from a
 * sandbox — this route does it from where the keys are.
 *
 * Guarded by PUSH_CRON_SECRET, the one shared secret this deployment already has, so it is
 * not an open window. Placed under /api/push only because that path already carries the
 * secret convention; it is unrelated to push and can be deleted once the list is confirmed.
 */
const EVENT_CHANNELS = [
  "blastpremier", "blasttv", "esl_csgo", "eslcs", "esl", "pgl_esports",
  "pgl_dota2", "fissuregg", "cct_csgo", "cct", "thunderpick", "dreamhackcs",
];

export async function GET(request: Request) {
  const secret = process.env.PUSH_CRON_SECRET;
  const offered = new URL(request.url).searchParams.get("s");
  if (!secret || offered !== secret) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const id = process.env.TWITCH_CLIENT_ID, cs = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !cs) return NextResponse.json({ error: "no twitch keys" }, { status: 501 });

  const tok = await (await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: cs, grant_type: "client_credentials" }),
  })).json();
  const auth = { "Client-Id": id, Authorization: `Bearer ${tok.access_token}` };

  const q = EVENT_CHANNELS.map((l) => `login=${encodeURIComponent(l)}`).join("&");
  const users = await (await fetch(`https://api.twitch.tv/helix/users?${q}`, { headers: auth })).json();
  const resolved: Record<string, string> = {};
  for (const u of users.data ?? []) resolved[u.login] = u.id;

  const since = new Date(Date.now() - 18 * 3600_000).toISOString();
  const report: Record<string, unknown> = {};
  for (const login of EVENT_CHANNELS) {
    const uid = resolved[login];
    if (!uid) { report[login] = "DID NOT RESOLVE"; continue; }
    const clips = await (await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${uid}&first=20&started_at=${since}`,
      { headers: auth },
    )).json();
    const list = (clips.data ?? []) as { title?: string; view_count?: number }[];
    report[login] = {
      clips_18h: list.length,
      top: list.map((c) => `${c.view_count}v ${String(c.title).slice(0, 30)}`).sort().reverse().slice(0, 4),
    };
  }
  return NextResponse.json({ resolved: Object.keys(resolved), report });
}
