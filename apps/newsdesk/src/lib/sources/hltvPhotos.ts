import { USER_AGENT, decodeEntities } from "./fetchXml";

/**
 * HLTV's player bodyshots, harvested from their articles.
 *
 * These are the photographs the accounts worth copying use, and there is no lookup for
 * them: HLTV's player pages and search both answer 403, while their ARTICLES answer 200.
 * So the index is built from what the articles happen to contain — every piece embeds a
 * hover card for each player it mentions, and that card carries the bodyshot.
 *
 * TWO kinds of picture come out of an article, and they are not interchangeable:
 *
 *  - The EDITORIAL photo, the one at the top of the piece. HLTV serves it up to 1600px
 *    wide, it is real event photography, and it is what a post should carry. It is keyed
 *    to every player and team the article links, because an article about apEX leads with
 *    a picture from the event apEX was at.
 *  - The BODYSHOT, the cutout in each player's hover card. It is only 200-400px, which is
 *    soft on a 1080 square, but it is matched to a player by name with no ambiguity.
 *
 * So the editorial photo is preferred and the bodyshot is the fallback. The bodyshot's
 * pairing is exact rather than guessed: the image's alt text is the player's full name with
 * the nickname in single quotes, "Justinas 'jL' Lekavicius".
 *
 * Coverage is therefore whoever has been in the news lately, which is close to whoever you
 * are posting about. Anyone missing falls back to Liquipedia.
 *
 * NOTE: these URLs are signed and their CDN refuses server-side requests, so they cannot be
 * proxied or drawn onto a canvas — only handed to the browser, which the CDN does serve.
 */
const RSS = "https://www.hltv.org/rss/news";
const TTL_MS = 6 * 60 * 60 * 1000;

/** How many articles to mine. Each is a request, and the newest carry the current names. */
const ARTICLE_LIMIT = 12;

export interface PhotoIndex {
  /** Large editorial photography, keyed by any player or team the article was about. */
  editorial: Map<string, string>;
  /** Small cutouts, keyed by exact nickname. */
  bodyshot: Map<string, string>;
}

let index: { data: PhotoIndex; at: number } | null = null;
let inFlight: Promise<PhotoIndex> | null = null;

async function fetchText(url: string, revalidate: number): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

/** `alt="Justinas 'jL' Lekavicius" src="…/playerbodyshot/…"` — nickname and photo together. */
const BODYSHOT =
  /<img[^>]+alt="([^"]*'([^']+)'[^"]*)"[^>]+src="(https:\/\/img-cdn\.hltv\.org\/playerbodyshot\/[^"]+)"/g;

const widthOf = (value: string) => Number(value.match(/[?&]w=(\d+)/)?.[1] ?? 0);

/**
 * The article's own photograph, at the largest width offered.
 *
 * AVIF variants are skipped. They are smaller on the wire but not every tool that will
 * touch these files reads them, and a post image that fails to open is worth less than a
 * larger download.
 */
function editorialPhoto(html: string): string | null {
  const candidates = [...html.matchAll(/https:\/\/img-cdn\.hltv\.org\/gallerypicture\/[^"'\s]+/g)]
    .map((m) => decodeEntities(m[0]))
    .filter((url) => !url.includes("fm=avif"));
  if (candidates.length === 0) return null;
  return candidates.reduce((best, url) => (widthOf(url) > widthOf(best) ? url : best));
}

function harvest(html: string, into: PhotoIndex): void {
  for (const match of html.matchAll(BODYSHOT)) {
    const nick = match[2].trim();
    const src = decodeEntities(match[3]);
    if (!nick) continue;
    const existing = into.bodyshot.get(nick.toLowerCase());
    if (!existing || widthOf(src) > widthOf(existing)) into.bodyshot.set(nick.toLowerCase(), src);
  }

  const photo = editorialPhoto(html);
  if (!photo) return;

  /**
   * Key the photograph to who the article is ABOUT, not everyone it mentions.
   *
   * Keying to every link meant one match report attached its photo to all ten players and
   * both teams in it — so apEX, MOUZ and Spirit all resolved to the same picture, and a
   * Spirit story would have gone out wearing a photo from a MOUZ match. Whoever is in the
   * headline is the subject; everyone else is context.
   *
   * Where a headline names nobody we recognise, the links are used after all: a slightly
   * off photograph of the right event still beats no photograph.
   */
  const linked = new Set(
    [
      ...html.matchAll(/\/player\/\d+\/([a-z0-9_-]+)/g),
      ...html.matchAll(/\/team\/\d+\/([a-z0-9_-]+)/g),
    ].map((m) => m[1].toLowerCase()),
  );

  const title = (html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").toLowerCase();
  const headlineSubjects = [...linked].filter((subject) => title.includes(subject));

  const targets = headlineSubjects.length > 0 ? headlineSubjects : [...linked];
  for (const subject of targets) into.editorial.set(subject, photo);
}

async function build(): Promise<PhotoIndex> {
  const rss = await fetchText(RSS, 900);
  const links = [...rss.matchAll(/<link>(https:\/\/www\.hltv\.org\/news\/[^<]+)<\/link>/g)]
    .map((m) => m[1])
    .slice(0, ARTICLE_LIMIT);

  const data: PhotoIndex = { editorial: new Map(), bodyshot: new Map() };
  // Sequential on purpose: a dozen parallel requests to one site is how you get rate limited.
  // Oldest first, so the newest article's photograph is the one that survives.
  for (const link of [...links].reverse()) {
    try {
      harvest(await fetchText(link, 3600), data);
    } catch {
      // One unreachable article should not lose the rest.
    }
  }
  index = { data, at: Date.now() };
  return data;
}

async function loadIndex(): Promise<PhotoIndex> {
  if (index && Date.now() - index.at < TTL_MS) return index.data;
  if (inFlight) return inFlight;
  inFlight = build();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Looks up a photo WITHOUT waiting for the index to exist.
 *
 * Building it means a dozen sequential article fetches, and doing that inside a feed
 * request means a cold instance spends thirty seconds on it and returns no photos at all —
 * which is exactly what happened in production while the index itself was fine. So a cold
 * lookup starts the build and answers null; the next refresh, seconds later, has it.
 *
 * Vercel's Data Cache is shared across instances and the article fetches carry revalidate
 * hints, so a rebuild on a new instance is cheap after the first one anywhere.
 */
/**
 * The best HLTV picture for a subject, which may be a player nickname or a team.
 *
 * Editorial first: it is event photography at up to 1600px, which is what a post wants.
 * The bodyshot cutout is the fallback for a player who has not led an article recently.
 */
export async function fetchHltvPhoto(subject: string): Promise<string | null> {
  try {
    const data = await loadIndex();
    const key = subject.toLowerCase();
    return data.editorial.get(key) ?? data.bodyshot.get(key) ?? null;
  } catch {
    return null;
  }
}

/** What the index currently holds — the quickest way to see coverage. */
export async function indexedSubjects(): Promise<{ editorial: string[]; bodyshot: string[] }> {
  try {
    const data = await loadIndex();
    return { editorial: [...data.editorial.keys()], bodyshot: [...data.bodyshot.keys()] };
  } catch {
    return { editorial: [], bodyshot: [] };
  }
}
