import { fetchJson } from "./fetchXml";

/**
 * Resolves a team's logo from its Liquipedia page, so a roster post can carry the badge
 * instead of going out as plain text.
 *
 * Route matters here, and the obvious ones are wrong. `prop=pageimages` returns nothing —
 * the extension is not populated on this wiki. `prop=images` batches beautifully and
 * returns garbage: a team page lists every opponent's logo from its match tables, so MOUZ
 * resolved to "4klogo" and Imperial Esports to "Red Canids logo". Posting a rival's badge
 * on a roster story is worse than posting no image, because the whole account runs on being
 * trusted to get details right.
 *
 * So this parses section 0 — the infobox — and takes its first image, which is the team's
 * own logo. Verified: Imperial Esports, MOUZ, Natus Vincere and Yawara all resolve
 * correctly. It costs one request per team and cannot be batched, which is why results are
 * cached for a day; logos essentially never change.
 *
 * PLAYER pages are deliberately not looked up. A player's infobox shows their *current
 * team's* badge, which on a transfer story is precisely the team they may be leaving.
 */

interface CachedLogo {
  url: string | null;
  at: number;
}

const cache = new Map<string, CachedLogo>();

/** Logos essentially never change, so a hit is cached for a day. */
const HIT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A miss is cached for minutes, not a day. Most misses are Liquipedia's rate limiter, and
 * caching a transient 429 for 24 hours means one unlucky moment blanks every badge until
 * tomorrow — which is exactly what happened before this split existed.
 */
const MISS_TTL_MS = 5 * 60 * 1000;

/** Page titles that read as an organisation rather than a person. */
const TEAM_SHAPE = /\b(Esports?|E-?Sports?|Gaming|Team|Club|Academy|Fe)\b/i;

export function looksLikeTeam(title: string): boolean {
  return TEAM_SHAPE.test(title);
}

/**
 * MediaWiki thumbnails carry their width in the path (`/39px-Name.png`). Infoboxes render
 * at tiny sizes, so rewrite to something X will not upscale into mush.
 */
function upscale(url: string): string {
  return url.replace(/\/(\d+)px-/, "/600px-");
}

export async function fetchTeamLogo(title: string): Promise<string | null> {
  const cached = cache.get(title);
  if (cached) {
    const ttl = cached.url ? HIT_TTL_MS : MISS_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.url;
  }

  try {
    const api =
      "https://liquipedia.net/counterstrike/api.php" +
      "?action=parse&format=json&prop=text&section=0&page=" +
      encodeURIComponent(title.replace(/ /g, "_"));

    const parsed = (await fetchJson(api, 86_400)) as {
      parse?: { text?: { "*"?: string } };
    };
    const html = parsed.parse?.text?.["*"] ?? "";

    const sources = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1]);
    // Liquipedia names logo files with a mode suffix; prefer one, else take the first image.
    const picked =
      sources.find((src) => /logo|allmode|lightmode|darkmode/i.test(src)) ?? sources[0];

    const url = picked
      ? upscale(picked.startsWith("http") ? picked : `https://liquipedia.net${picked}`)
      : null;

    cache.set(title, { url, at: Date.now() });
    return url;
  } catch {
    // A missing logo must never fail the feed — the quote card is the fallback media.
    cache.set(title, { url: null, at: Date.now() });
    return null;
  }
}
