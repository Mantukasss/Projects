import type { FeedItem, Kind } from "../types";
import { asArray, decodeEntities, fetchXml } from "./fetchXml";

const FEED = "https://www.hltv.org/rss/news";

interface RssItem {
  title?: string;
  description?: string;
  link?: string;
  guid?: string | { "#text"?: string };
  pubDate?: string;
  "media:content"?: { "@_url"?: string } | { "@_url"?: string }[];
}

const ROSTER_WORDS =
  /\b(joins?|signs?|leaves?|benche[ds]|steps? down|parts? ways|transfer|roster|stand-?in|loan|releases?|returns? to)\b/i;
const RESULT_WORDS =
  /\b(defeat|beat|eliminate[sd]?|advance[sd]?|knock(ed)? out|win[s]?|claim|qualif|champions?)\b/i;

/**
 * HLTV titles are already written as "player: \"quote\"" for interview pieces,
 * which is exactly the shape that performs on X — so detecting it is worth doing.
 */
function classify(title: string): Kind {
  if (/^[^:]{2,30}:\s*["“]/.test(title)) return "quote";
  if (ROSTER_WORDS.test(title)) return "roster";
  if (RESULT_WORDS.test(title)) return "result";
  return "news";
}

export async function fetchHltv(): Promise<FeedItem[]> {
  const parsed = (await fetchXml(FEED, 60)) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };
  const items = asArray(parsed.rss?.channel?.item);

  return items.flatMap((raw): FeedItem[] => {
    const title = decodeEntities(String(raw.title ?? "")).trim();
    const url = String(raw.link ?? "").trim();
    if (!title || !url) return [];

    const media = asArray(raw["media:content"])[0];
    const image = media?.["@_url"]?.trim() || undefined;
    const guid = typeof raw.guid === "object" ? raw.guid?.["#text"] : raw.guid;

    return [
      {
        id: `hltv:${guid ?? url}`,
        source: "hltv",
        kind: classify(title),
        title,
        summary: decodeEntities(String(raw.description ?? "")).trim(),
        url,
        publishedAt: raw.pubDate ? new Date(raw.pubDate).toISOString() : new Date().toISOString(),
        image,
        score: 0,
        reasons: [],
      },
    ];
  });
}
