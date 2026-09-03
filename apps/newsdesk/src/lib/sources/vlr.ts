import type { FeedItem } from "../types";
import { asArray, decodeEntities, fetchXml } from "./fetchXml";

const FEED = "https://www.vlr.gg/rss/news";

interface RssItem {
  title?: string;
  description?: string;
  link?: string;
  guid?: string | { "#text"?: string };
  pubDate?: string;
}

/**
 * VALORANT. Off by default: a single-game account outranks a multi-game one because X
 * clusters an account by who engages with it, and split topics split that cluster.
 * Kept wired up so a second, VAL-only account can reuse this backend later.
 */
export async function fetchVlr(): Promise<FeedItem[]> {
  const parsed = (await fetchXml(FEED, 120)) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };

  return asArray(parsed.rss?.channel?.item).flatMap((raw): FeedItem[] => {
    const title = decodeEntities(String(raw.title ?? "")).trim();
    const url = String(raw.link ?? "").trim();
    if (!title || !url) return [];
    const guid = typeof raw.guid === "object" ? raw.guid?.["#text"] : raw.guid;

    return [
      {
        id: `vlr:${guid ?? url}`,
        source: "vlr",
        kind: "news",
        title,
        summary: decodeEntities(String(raw.description ?? "")).trim(),
        url,
        publishedAt: raw.pubDate ? new Date(raw.pubDate).toISOString() : new Date().toISOString(),
        score: 0,
        reasons: [],
      },
    ];
  });
}
