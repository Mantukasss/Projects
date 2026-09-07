import type { FeedItem } from "../types";
import { asArray, decodeEntities, fetchXml } from "./fetchXml";

/**
 * YouTube channels that publish INTERVIEWS, which is where the quotes are.
 *
 * HLTV's channel carries HLTV Confirmed — their talk show, three hundred-odd episodes of
 * players and analysts being asked questions on the record. The episode titles are
 * effectively a contents page: "lauNX talks FUT & future; Techno to BCG, Snappi to coach?"
 * names three stories before you have watched a second of it.
 *
 * This is not a highlights feed. Tournament channels were tested and rejected — BLAST and
 * ESL upload clutches and best-of reels, and PGL's channel is Dota. Highlights are already
 * covered by Twitch clips, which are faster and closer to the moment.
 *
 * Per-channel RSS is free, needs no key and has no quota, unlike the YouTube Data API.
 */
interface Channel {
  id: string;
  label: string;
}

const CHANNELS: Channel[] = [
  { id: "UCXbsUubmNPK8XJFbkmlMcMg", label: "HLTV" },
];

/**
 * Titles that promise someone saying something. A channel also posts highlight clips, and
 * a clip of an ace is not a quote — Twitch already covers those, sooner.
 */
const INTERVIEW_SHAPE =
  /\b(talks?|says?|on|interview|confirmed|reacts?|explains?|discusses|answers|q&a|podcast|press)\b/i;

/** Reels and shorts, which are the highlight side of the same channel. */
const HIGHLIGHT_SHAPE =
  /\b(ace|clutch|1v[2-5]|highlights?|best moments|funny|plays?|frag|spray|shorts?)\b/i;

interface RssEntry {
  title?: string;
  published?: string;
  updated?: string;
  link?: { "@_href"?: string } | { "@_href"?: string }[];
  id?: string;
  "media:group"?: {
    "media:description"?: string;
    "media:thumbnail"?: { "@_url"?: string };
  };
}

async function fetchChannel(channel: Channel): Promise<FeedItem[]> {
  const parsed = (await fetchXml(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`,
    600,
  )) as { feed?: { entry?: RssEntry | RssEntry[] } };

  return asArray(parsed.feed?.entry).flatMap((entry): FeedItem[] => {
    const title = decodeEntities(String(entry.title ?? "")).trim();
    const url = asArray(entry.link)[0]?.["@_href"];
    if (!title || !url) return [];

    // Interview-shaped, and not a highlight reel wearing an interview word.
    if (!INTERVIEW_SHAPE.test(title) || HIGHLIGHT_SHAPE.test(title)) return [];

    const group = entry["media:group"];

    return [
      {
        id: `youtube:${entry.id ?? url}`,
        source: "youtube",
        kind: "quote",
        title,
        summary: decodeEntities(String(group?.["media:description"] ?? "")).slice(0, 400),
        url,
        publishedAt: new Date(entry.published ?? entry.updated ?? Date.now()).toISOString(),
        image: group?.["media:thumbnail"]?.["@_url"],
        score: 0,
        reasons: [`${channel.label} interview`],
      },
    ];
  });
}

export async function fetchYoutube(): Promise<FeedItem[]> {
  const settled = await Promise.allSettled(CHANNELS.map(fetchChannel));
  const items = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (items.length === 0 && settled.every((r) => r.status === "rejected")) {
    throw new Error("all YouTube channels failed");
  }
  return items;
}
