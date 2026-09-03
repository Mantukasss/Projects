import type { FeedItem } from "../types";
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

/**
 * Valve embeds its announcement artwork as a bare URL inside the post body, and Steam's
 * news API exposes no image field at all — so the only way to get the picture that belongs
 * with the post is to lift it out of the text.
 */
const EMBEDDED_IMAGE = /https:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif)/i;

/**
 * Patch notes arrive as run-together prose: "provide custom UI.Panel, Label, Image and
 * Button panel types are supported." Steam's own formatting is stripped by maxlength, so
 * sentence boundaries lose their spaces and the text reads as a typo without this.
 */
function tidy(text: string): string {
  return text
    .replace(EMBEDDED_IMAGE, " ")
    .replace(/\\+/g, " ")
    // Colons and full stops lose their trailing space; URLs are already stripped above, so
    // there is no "https:" left to damage by spacing after a colon.
    .replace(/([.!?])(?=[A-Za-z])/g, "$1 ")
    .replace(/(\w):(?=\w)/g, "$1: ")
    .replace(/\s+/g, " ")
    .trim();
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

    const contents = stripTags(raw.contents ?? "");

    return [
      {
        id: `steam:${raw.gid ?? url}`,
        source: "steam",
        kind: "news",
        title,
        summary: tidy(contents).slice(0, 400),
        url,
        image: contents.match(EMBEDDED_IMAGE)?.[0],
        publishedAt: new Date((raw.date ?? Date.now() / 1000) * 1000).toISOString(),
        score: 0,
        reasons: [],
      },
    ];
  });
}
