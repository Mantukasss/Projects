import type { FeedItem } from "../types";

/**
 * Twitch clips from T1/T2 EVENT BROADCASTS ONLY — highlights and interviews off the official
 * stream, and nothing else.
 *
 * WHAT THIS USED TO DO AND WHY IT WAS WRONG: it also asked Twitch "what is the whole
 * Counter-Strike category clipping hardest right now?" via the game_id endpoint. That endpoint
 * returns clips from ANY streamer playing CS, and random-streamer clip communities dominate
 * it — the feed filled with "placz wasa", "nauka pickowania jak donk", "reakcja": some guy's
 * ranked game, not the news. There is no view threshold that fixes it, because a popular
 * streamer's throwaway clip out-views a genuine T2 event highlight. The category firehose is
 * removed. A clip is only news if it came off an event broadcast.
 *
 * WHY VIEWS AND TITLE STILL MATTER even on the right channels: the official channel's chat
 * clips every round — "12-11", "11-11", "20260907", one view each. That is not a highlight,
 * it is someone leaning on the clip button. A real highlight is the one hundreds of people
 * clipped and came back to watch, so a clip needs genuine views AND a title that is not a
 * scoreline, a date or a bare number.
 *
 * Needs a free Twitch application: TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET. Without them the
 * source raises and the feed carries on without it.
 *
 * A channel login that no longer resolves is silently absent from the /users response, not an
 * error — so a renamed or wrong login just disappears rather than breaking the source. That
 * is the safety net under the channel list: a bad guess costs nothing, it simply returns no
 * clips. If an event's clips stop appearing, check its login here first.
 */
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const HELIX = "https://api.twitch.tv/helix";

/**
 * The official broadcast channels for T1 and T2 Counter-Strike events.
 *
 * This is the whole source now — there is no category-wide fallback behind it. Every entry is
 * an event ORGANISER's channel, never a player's or a watch-party's, because the point is a
 * moment that happened ON THE EVENT STAGE. Unresolvable logins drop silently (see above), so
 * the list can hold a login that is currently dormant without cost.
 *
 * T1: BLAST, ESL/IEM, PGL, FISSURE. T2: CCT, ESL Challenger, Thunderpick/other circuits as
 * their logins are confirmed. Verify a new addition by watching the live feed attribute a
 * clip to it before trusting it — the same discipline the X org handles needed.
 */
const EVENT_CHANNELS = [
  // VERIFIED live against Twitch's /users from Vercel (where the keys are). These six
  // resolve and are Counter-Strike broadcasts. The guesses that did NOT resolve are recorded
  // so nobody re-adds them: blasttv, fissuregg, cct, cct_csgo, dreamhackcs. pgl_dota2
  // resolved but is Dota, so it is out. Find a real login the way the org X handles were
  // found — from the source's own page — not by guessing, if you add one.
  "blastpremier",
  "eslcs",
  "esl_csgo",
  "esl",
  "pgl_esports",
  "thunderpick",
]

/** How far back to look. A clip older than this is not news. */
const WINDOW_HOURS = 18;

/**
 * The view floor for a highlight to count.
 *
 * DELIBERATELY LOW, and this number is a guess that needs live tuning — Twitch keys are only
 * in Vercel, so the real view distribution of event highlights cannot be measured from a
 * sandbox. The real work is done by two filters this only backstops: the event-channel
 * allowlist (no random streamers at all) and isJunkTitle (no "12-11" round-spam). The floor
 * just clears the one-to-single-digit-view round clips that slip past a non-junk title, and
 * the sort below floats the biggest moments regardless. Set at 150 first and it starved the
 * source to nothing between events; if junk with a real title and 40+ views creeps in, the
 * lever to raise is this one.
 */
const MIN_VIEWS = 40;

/**
 * Titles that are noise, not a highlight.
 *
 * A broadcast clip's title is whatever the clipper typed, and on the official channel that is
 * usually nothing worth reading: the current score ("12-11"), the date ("20260907"), a bare
 * number, or a single stray word. A real highlight tends to name who did what. These are the
 * shapes seen dominating @blastpremier in the live feed.
 */
function isJunkTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 4) return true; // "13-2", "gg"
  if (/^\d+\s*[-:vx]\s*\d+$/i.test(t)) return true; // a scoreline: 12-11, 13:7, 2-0
  if (/^\d[\d\s.:/-]*$/.test(t)) return true; // a date or bare number: 20260907, 09/07
  if (/^[a-z0-9]{1,3}$/i.test(t)) return true; // "wp", "ez", "1k"
  return false;
}

interface TwitchClip {
  id?: string;
  url?: string;
  title?: string;
  broadcaster_name?: string;
  creator_name?: string;
  view_count?: number;
  created_at?: string;
  thumbnail_url?: string;
  duration?: number;
}

let token: { value: string; expires: number } | null = null;

async function appToken(): Promise<string> {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Twitch keys not configured");

  // Tokens last ~60 days; refreshing a minute early avoids racing the expiry.
  if (token && Date.now() < token.expires - 60_000) return token.value;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Twitch token ${res.status}: ${(await res.text()).slice(0, 120)}`);

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Twitch returned no token");
  token = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return token.value;
}

async function helix(path: string, revalidate: number): Promise<Record<string, unknown>> {
  const res = await fetch(`${HELIX}${path}`, {
    headers: {
      "Client-Id": process.env.TWITCH_CLIENT_ID ?? "",
      Authorization: `Bearer ${await appToken()}`,
    },
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`Twitch ${path} -> ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

/** Twitch keys everything by numeric id, so logins resolve first. */
async function broadcasterIds(logins: string[]): Promise<{ id: string; login: string }[]> {
  // /users takes up to 100 logins at once, so one call resolves the whole list.
  const query = logins.map((l) => `login=${encodeURIComponent(l)}`).join("&");
  const data = (await helix(`/users?${query}`, 86_400)) as {
    data?: { id?: string; login?: string }[];
  };
  const out: { id: string; login: string }[] = [];
  for (const user of data.data ?? []) if (user.id && user.login) out.push({ id: user.id, login: user.login });
  return out;
}

/** Thumbnails come with placeholders for the size, which have to be filled in. */
function thumbnail(url: string | undefined): string | undefined {
  return url?.replace("%{width}", "1280").replace("%{height}", "720");
}

function toItem(clip: TwitchClip): FeedItem | null {
  if (!clip.id || !clip.url || !clip.title) return null;
  const views = clip.view_count ?? 0;
  return {
    id: `twitch:${clip.id}`,
    source: "twitch",
    kind: "news",
    title: clip.title.trim(),
    summary: `${views.toLocaleString()} views · clipped from ${clip.broadcaster_name ?? "the broadcast"}`,
    url: clip.url,
    publishedAt: clip.created_at ?? new Date().toISOString(),
    image: thumbnail(clip.thumbnail_url),
    score: 0,
    // Views carried into the reasons so the card, and the scorer, can see the number that
    // decided this clip was a highlight rather than a round nobody watched.
    reasons: [`${views.toLocaleString()} views`, `${clip.broadcaster_name ?? "event"} broadcast`],
  };
}

export async function fetchTwitch(): Promise<FeedItem[]> {
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
  const items: FeedItem[] = [];

  const channels = await broadcasterIds(EVENT_CHANNELS);
  /**
   * Not one login resolved — that is the channel list being wrong, not a quiet day, and it
   * is worth surfacing rather than swallowing. A quiet day resolves channels and finds no
   * qualifying clips; this finds no channels at all.
   */
  if (channels.length === 0) throw new Error("no Twitch event channels resolved — check the logins");

  for (const { id } of channels) {
    try {
      const data = (await helix(`/clips?broadcaster_id=${id}&first=30&started_at=${since}`, 300)) as {
        data?: TwitchClip[];
      };
      for (const clip of data.data ?? []) {
        if ((clip.view_count ?? 0) < MIN_VIEWS) continue;
        if (isJunkTitle(clip.title ?? "")) continue;
        const item = toItem(clip);
        if (item) items.push(item);
      }
    } catch {
      // One channel failing must not lose the others.
    }
  }

  // Best-viewed first, so if the feed's cap trims Twitch it keeps the biggest moments.
  items.sort((a, b) => {
    const va = Number(a.reasons[0]?.replace(/\D/g, "") || 0);
    const vb = Number(b.reasons[0]?.replace(/\D/g, "") || 0);
    return vb - va;
  });

  /**
   * Empty is a normal answer, NOT an error. Between events there are no fresh event-broadcast
   * highlights, and that is correct — the old code threw here and lit up the feed's error
   * row on a perfectly healthy quiet day. It throws only when it could not TALK to Twitch at
   * all (missing keys, every channel call failing), which appToken/helix already surface.
   */
  return items;
}
