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
