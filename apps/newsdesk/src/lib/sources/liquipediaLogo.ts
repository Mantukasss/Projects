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

/** Liquipedia is one wiki per game; a VALORANT org has no page on the Counter-Strike one. */
export type Wiki = "counterstrike" | "valorant";

/**
 * Pulls the section-0 HTML of a Liquipedia page, cached, so both the crest and the portrait
 * readers work from one request.
 */
async function fetchInfoboxHtml(title: string, wiki: Wiki): Promise<string> {
  const api =
    `https://liquipedia.net/${wiki}/api.php` +
    "?action=parse&format=json&prop=text&section=0&page=" +
    encodeURIComponent(title.replace(/ /g, "_"));
  const parsed = (await fetchJson(api, 86_400)) as { parse?: { text?: { "*"?: string } } };
  return parsed.parse?.text?.["*"] ?? "";
}

/** Liquipedia names logo files with a mode suffix, and flags live under a Flag path. */
const LOGO_FILE = /logo|allmode|lightmode|darkmode/i;
const FLAG_FILE = /\/Flag|flag_|_flag/i;

/**
 * A player's PHOTOGRAPH, which is not the first image on their page.
 *
 * A player infobox leads with their team's crest and a country flag, so taking the first
 * image — the rule that is right for a team page — returned Team Spirit's badge as
 * "zont1x", and the generated poster came out with a dark logo behind the words instead of
 * a face. The portrait is identified by the file being named after the player, and failing
 * that by being neither a crest nor a flag.
 */
export async function fetchPlayerPhoto(
  name: string,
  wiki: Wiki = "counterstrike",
): Promise<string | null> {
  const key = `photo:${wiki}:${name}`;
  const cached = cache.get(key);
  if (cached) {
    const ttl = cached.url ? HIT_TTL_MS : MISS_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.url;
  }

  try {
    const html = await fetchInfoboxHtml(name, wiki);
    const sources = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1]);

    const nickname = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const named = sources.find((src) =>
      src.toLowerCase().replace(/[^a-z0-9]/g, "").includes(nickname),
    );
    const anyPortrait = sources.find(
      (src) => !LOGO_FILE.test(src) && !FLAG_FILE.test(src),
    );
    const picked = named ?? anyPortrait ?? null;

    const url = picked
      ? upscale(picked.startsWith("http") ? picked : `https://liquipedia.net${picked}`)
      : null;
    cache.set(key, { url, at: Date.now() });
    return url;
  } catch {
    cache.set(key, { url: null, at: Date.now() });
    return null;
  }
}

export async function fetchTeamLogo(
  title: string,
  wiki: Wiki = "counterstrike",
): Promise<string | null> {
  const key = `${wiki}:${title}`;
  const cached = cache.get(key);
  if (cached) {
    const ttl = cached.url ? HIT_TTL_MS : MISS_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.url;
  }


  try {
    const api =
      `https://liquipedia.net/${wiki}/api.php` +
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

    cache.set(key, { url, at: Date.now() });
    return url;
  } catch {
    // A missing logo must never fail the feed — the quote card is the fallback media.
    cache.set(key, { url: null, at: Date.now() });
    return null;
  }
}
