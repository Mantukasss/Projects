import type { FeedItem } from "../types";
import { asArray, decodeEntities, fetchXml, stripTags } from "./fetchXml";

const FEED = "https://www.reddit.com/r/GlobalOffensive/new/.rss";

interface AtomEntry {
  title?: string;
  content?: string | { "#text"?: string };
  link?: { "@_href"?: string } | { "@_href"?: string }[];
  id?: string;
  published?: string;
  updated?: string;
}

/**
 * Reddit is the early-warning channel, not a citable source: clips and drama surface
 * here before the sites write them up. score.ts weights it below HLTV for that reason.
 *
 * OFF BY DEFAULT, and not because of the content. Reddit rate-limits its public .rss
 * endpoints by IP and returns 429 to datacenter ranges — which is every serverless host,
 * this one included. Verified: the same request succeeds from a residential IP and fails
 * from here under any User-Agent. Turning it on needs a free Reddit OAuth app (script
 * type, 100 requests/minute) and a token exchange; see this app's README. Until then the
 * feed degrades gracefully and simply omits it.
 */
export async function fetchReddit(): Promise<FeedItem[]> {
  const parsed = (await fetchXml(FEED, 120)) as { feed?: { entry?: AtomEntry | AtomEntry[] } };

  return asArray(parsed.feed?.entry).flatMap((entry): FeedItem[] => {
    const title = decodeEntities(String(entry.title ?? "")).trim();
    const url = asArray(entry.link)[0]?.["@_href"]?.trim();
    if (!title || !url) return [];

    const rawContent = typeof entry.content === "object" ? entry.content?.["#text"] : entry.content;

    return [
      {
        id: `reddit:${entry.id ?? url}`,
        source: "reddit",
        kind: "news",
        title,
        summary: stripTags(String(rawContent ?? "")).slice(0, 240),
        url,
        publishedAt: new Date(entry.published ?? entry.updated ?? Date.now()).toISOString(),
        score: 0,
        reasons: [],
      },
    ];
  });
}
