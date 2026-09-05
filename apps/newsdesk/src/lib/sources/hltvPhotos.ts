import { USER_AGENT, decodeEntities } from "./fetchXml";

/**
 * HLTV's player bodyshots, harvested from their articles.
 *
 * These are the photographs the accounts worth copying use, and there is no lookup for
 * them: HLTV's player pages and search both answer 403, while their ARTICLES answer 200.
 * So the index is built from what the articles happen to contain — every piece embeds a
 * hover card for each player it mentions, and that card carries the bodyshot.
 *
 * The pairing is exact rather than guessed. The image's alt text is the player's full name
 * with the nickname in single quotes — "Justinas 'jL' Lekavicius" — so the nickname comes
 * out of the markup rather than being inferred from a filename.
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

let index: { byNick: Map<string, string>; at: number } | null = null;
let inFlight: Promise<Map<string, string>> | null = null;

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

function harvest(html: string, into: Map<string, string>): void {
  for (const match of html.matchAll(BODYSHOT)) {
    const nick = match[2].trim();
    const src = decodeEntities(match[3]);
    if (!nick) continue;
    // Prefer the widest variant seen: articles embed the same shot at several sizes.
    const existing = into.get(nick.toLowerCase());
    const width = (value: string) => Number(value.match(/[?&]w=(\d+)/)?.[1] ?? 0);
    if (!existing || width(src) > width(existing)) into.set(nick.toLowerCase(), src);
  }
}

async function build(): Promise<Map<string, string>> {
  const rss = await fetchText(RSS, 900);
  const links = [...rss.matchAll(/<link>(https:\/\/www\.hltv\.org\/news\/[^<]+)<\/link>/g)]
    .map((m) => m[1])
    .slice(0, ARTICLE_LIMIT);

  const byNick = new Map<string, string>();
  // Sequential on purpose: eight parallel requests to one site is how you get rate limited.
  for (const link of links) {
    try {
      harvest(await fetchText(link, 3600), byNick);
    } catch {
      // One unreachable article should not lose the other seven.
    }
  }
  index = { byNick, at: Date.now() };
  return byNick;
}

async function loadIndex(): Promise<Map<string, string>> {
  if (index && Date.now() - index.at < TTL_MS) return index.byNick;
  if (inFlight) return inFlight;
  inFlight = build();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export async function fetchHltvPhoto(nickname: string): Promise<string | null> {
  try {
    return (await loadIndex()).get(nickname.toLowerCase()) ?? null;
  } catch {
    return null;
  }
}

/** Every nickname currently indexed — useful for seeing what coverage looks like. */
export async function indexedNicknames(): Promise<string[]> {
  try {
    return [...(await loadIndex()).keys()];
  } catch {
    return [];
  }
}
