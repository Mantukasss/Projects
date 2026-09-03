import { XMLParser } from "fast-xml-parser";

/**
 * Liquipedia's API terms require a descriptive User-Agent with contact details,
 * and HLTV serves its RSS more reliably to a named client than to a bare fetch.
 */
export const USER_AGENT =
  "CS2Newsdesk/0.1 (https://github.com/mantukasss/projects; contact via GitHub)";

/**
 * Liquipedia returns 429 to any client that does not advertise gzip support — their API
 * terms require it, and the rejection looks exactly like a rate limit, so it is worth
 * being explicit rather than relying on the runtime's defaults.
 */
const BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept-Encoding": "gzip",
} as const;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  /**
   * The parser caps XML entity expansion to blunt "billion laughs" bombs, where a tiny
   * document expands into gigabytes and takes the server with it. The default cap of 1000
   * total expansions is below what a legitimate feed uses: Reddit escapes the full HTML of
   * every post into its Atom <content>, which runs past 1200 entities and made the whole
   * source fail with "Entity expansion limit exceeded: 1250 > 1000".
   *
   * So this raises the ceiling rather than removing it — the protection still holds, at a
   * level real feeds do not reach. maxExpandedLength stays bounded for the same reason:
   * that, not the count, is what actually caps memory.
   */
  processEntities: {
    enabled: true,
    maxTotalExpansions: 100_000,
    maxExpandedLength: 20_000_000,
  },
});

export async function fetchXml(url: string, revalidate: number): Promise<unknown> {
  const res = await fetch(url, {
    headers: { ...BASE_HEADERS, Accept: "application/rss+xml, application/xml, text/xml" },
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return parser.parse(await res.text());
}

export async function fetchJson(url: string, revalidate: number): Promise<unknown> {
  const res = await fetch(url, {
    headers: { ...BASE_HEADERS, Accept: "application/json" },
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

/** RSS/Atom parsers hand back a single object when a feed has exactly one entry. */
export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function decodeEntities(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}
