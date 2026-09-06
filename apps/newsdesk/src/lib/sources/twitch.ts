import type { FeedItem } from "../types";

/**
 * Twitch clips — the source behind the quotes that never reach an article.
 *
 * Post-match interviews air on the tournament broadcast and casters talk for hours around
 * them. HLTV writes up perhaps two interviews a day; a broadcast produces one after every
 * series. Whoever clips those first has quotes nobody else in English has, which is the
 * whole reason this source exists rather than another news feed.
 *
 * Two questions get asked of Twitch, and they are different:
 *
 *  - What did the TOURNAMENT channels clip? Those are the interviews and desk segments.
 *  - What is being clipped hardest across Counter-Strike right now? A clip climbing fast is
 *    a moment happening, and it surfaces before anyone writes it up.
 *
 * Needs a free Twitch application: TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET. Without them
 * the source raises and the feed simply carries on without it.
 */
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const HELIX = "https://api.twitch.tv/helix";

/** The broadcasts that actually run CS interviews. */
const TOURNAMENT_CHANNELS = ["blastpremier", "esl_csgo", "pgl_esports", "blasttv"];

/** How far back to look. A clip older than this is not news. */
const WINDOW_HOURS = 18;

/** Below this a clip is one person laughing, not a moment. */
const MIN_VIEWS = 60;

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

/** Twitch keys everything by numeric id, so logins and game names resolve first. */
async function broadcasterIds(logins: string[]): Promise<Map<string, string>> {
  const query = logins.map((l) => `login=${encodeURIComponent(l)}`).join("&");
  const data = (await helix(`/users?${query}`, 86_400)) as {
    data?: { id?: string; login?: string }[];
  };
  const out = new Map<string, string>();
  for (const user of data.data ?? []) if (user.id && user.login) out.set(user.login, user.id);
  return out;
}

async function counterStrikeGameId(): Promise<string | null> {
  const data = (await helix(`/games?name=${encodeURIComponent("Counter-Strike")}`, 86_400)) as {
    data?: { id?: string }[];
  };
  return data.data?.[0]?.id ?? null;
}

/** Thumbnails come with placeholders for the size, which have to be filled in. */
function thumbnail(url: string | undefined): string | undefined {
  return url?.replace("%{width}", "1280").replace("%{height}", "720");
}

function toItem(clip: TwitchClip, kind: "interview" | "moment"): FeedItem | null {
  if (!clip.id || !clip.url || !clip.title) return null;

  return {
    id: `twitch:${clip.id}`,
    source: "twitch",
    kind: "news",
    title: clip.title.trim(),
    summary:
      kind === "interview"
        ? `Clipped from ${clip.broadcaster_name ?? "the broadcast"} · ${clip.view_count ?? 0} views`
        : `${clip.view_count ?? 0} views on ${clip.broadcaster_name ?? "Twitch"}`,
    url: clip.url,
    publishedAt: clip.created_at ?? new Date().toISOString(),
    image: thumbnail(clip.thumbnail_url),
    // The clip is the media; a post about a moment should carry the moment.
    videoUrl: undefined,
    score: 0,
    reasons: [kind === "interview" ? "broadcast clip" : `${clip.view_count ?? 0} views`],
  };
}

export async function fetchTwitch(): Promise<FeedItem[]> {
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
  const items: FeedItem[] = [];

  // The tournament channels first: this is where interviews live.
  const ids = await broadcasterIds(TOURNAMENT_CHANNELS);
  for (const id of ids.values()) {
    try {
      const data = (await helix(`/clips?broadcaster_id=${id}&first=20&started_at=${since}`, 300)) as {
        data?: TwitchClip[];
      };
      for (const clip of data.data ?? []) {
        const item = toItem(clip, "interview");
        if (item) items.push(item);
      }
    } catch {
      // One channel failing must not lose the others or the game-wide sweep.
    }
  }

  // Then whatever the game as a whole is clipping hardest — a moment in progress.
  try {
    const gameId = await counterStrikeGameId();
    if (gameId) {
      const data = (await helix(`/clips?game_id=${gameId}&first=30&started_at=${since}`, 300)) as {
        data?: TwitchClip[];
      };
      for (const clip of data.data ?? []) {
        if ((clip.view_count ?? 0) < MIN_VIEWS) continue;
        const item = toItem(clip, "moment");
        if (item) items.push(item);
      }
    }
  } catch {
    // Same again: partial results beat none.
  }

  if (items.length === 0) throw new Error("Twitch returned nothing usable");
  return items;
}
