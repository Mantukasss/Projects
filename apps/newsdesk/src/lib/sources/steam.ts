import type { FeedItem, Kind } from "../types";
import { fetchJson, stripTags } from "./fetchXml";

/**
 * Valve's own CS2 announcements, straight from Steam's news API. Unauthenticated, no key,
 * no rate limit worth worrying about.
 *
 * This is the highest-value non-roster source in the feed: a game update is the one story
 * every CS player cares about at once, it is announced with no warning, and being first to
 * post the patch notes is a reliable way to get in front of people who do not follow you.
 * appid 730 is Counter-Strike 2.
 */
const API =
  "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/" +
  "?appid=730&count=15&maxlength=400&format=json";

interface NewsItem {
  gid?: string;
  title?: string;
  url?: string;
  contents?: string;
  date?: number;
  feedlabel?: string;
}

/** Valve's own posts are the story; third-party reprints in the same feed are not. */
const VALVE_FEEDS = /^(steam_community_announcements|steam_updates|Product Update|Community Announcements)$/i;

function classify(title: string): Kind {
  if (/\b(update|patch|release notes|hotfix)\b/i.test(title)) return "news";
  return "news";
}

export async function fetchSteam(): Promise<FeedItem[]> {
  const parsed = (await fetchJson(API, 60)) as {
    appnews?: { newsitems?: NewsItem[] };
  };

  return (parsed.appnews?.newsitems ?? []).flatMap((raw): FeedItem[] => {
    const title = (raw.title ?? "").trim();
    const url = (raw.url ?? "").trim();
    if (!title || !url) return [];

    // Steam mixes Valve's announcements with syndicated press. Keep Valve's.
    const label = (raw.feedlabel ?? "").trim();
    if (label && !VALVE_FEEDS.test(label)) return [];

    return [
      {
        id: `steam:${raw.gid ?? url}`,
        source: "steam",
        kind: classify(title),
        title,
        summary: stripTags(raw.contents ?? "").slice(0, 240),
        url,
        publishedAt: new Date((raw.date ?? Date.now() / 1000) * 1000).toISOString(),
        score: 0,
        reasons: [],
      },
    ];
  });
}
