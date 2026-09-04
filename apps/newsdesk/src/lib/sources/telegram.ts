import type { FeedItem } from "../types";
import { USER_AGENT, decodeEntities } from "./fetchXml";

/**
 * Public Telegram channels, read through the `t.me/s/<channel>` web preview.
 *
 * No API, no key, no auth — the preview page is plain HTML and any public channel exposes
 * its last ~20 posts there. This is the fastest surface in the whole app, because Telegram
 * is where the CS scene actually talks first.
 *
 * Two channels earn their place for different reasons:
 *
 *  - `cstracker` watches Valve's Steam depots and fires when a CS2 build changes. That is
 *    a machine-observed fact, so it lands BEFORE Valve announces anything and before any
 *    journalist can write it up. Nothing else in this app is first in that sense.
 *  - `newcsgo` is Russian-language and breaks CIS roster news well ahead of English
 *    outlets. Most English CS accounts do not read it, which is exactly why it is worth
 *    reading. Posts are marked `ru` so the composer can flag that they need translating.
 *
 * Not solved here: the Russian posts arrive untranslated, and telling banter from a report
 * across a language barrier is guesswork — `looksLikeNews` below is a blunt filter, not
 * comprehension. A free Groq or Gemini key would let a server-side call translate and
 * classify each post in one step; see the root CLAUDE.md for how those keys are wired.
 */

export interface ChannelConfig {
  handle: string;
  label: string;
  language: "en" | "ru";
  /** Why this channel exists in the feed, shown to the user. */
  note: string;
}

export const CHANNELS: ChannelConfig[] = [
  {
    handle: "cstracker",
    label: "CS Tracker",
    language: "ru",
    note: "Valve build changes, detected from Steam depots before any announcement",
  },
  {
    handle: "newcsgo",
    label: "CS2NEWS",
    language: "ru",
    note: "Russian-language CIS scene news, usually ahead of English outlets",
  },
];

/**
 * These channels fund themselves with skin-gambling and betting promos, and they run banter
 * between the news. Neither is postable, and because Telegram posts are always the freshest
 * thing in the feed, an unfiltered joke outranks every real story — which is how a ranking
 * built on recency quietly becomes useless.
 */
const PROMO = /(cs\.money|csgoroll|промокод|реклама|скидк|подписывайся|партнёр|партнер|розыгрыш|бонус|ставк|betting|casino)/i;

/** A real report names someone or something; banter usually does not. */
function looksLikeNews(text: string): boolean {
  if (PROMO.test(text)) return false;
  if (text.length < 25) return false;
  // A capitalised name in either alphabet, or a number worth reporting.
  return /[A-Z][a-zA-Z0-9]{2,}|[А-ЯЁ][а-яё]{2,}|\d/.test(text);
}

/** Telegram's preview markup is stable enough to read with targeted patterns. */
const MESSAGE_RE =
  /<div class="tgme_widget_message[^"]*"[^>]*data-post="([^"]+)"[\s\S]*?(?=<div class="tgme_widget_message[^"]*"[^>]*data-post=|<\/section>)/g;

function extractText(block: string): string {
  const match = block.match(
    /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/,
  );
  if (!match) return "";
  return decodeEntities(
    match[1]
      // <br> is a real line break in these posts and carries the structure.
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * The still image: a photo attachment, or a video's thumbnail.
 *
 * Telegram serves both from the same CDN and marks them with different classes, so a post
 * carrying a clip used to come through with no picture at all — which is how "What are
 * BC.Game players doing at the bootcamp?" ended up with nothing but a game capsule beside
 * it, when the clip was the entire post.
 */
function extractPhoto(block: string): string | undefined {
  const photo = block.match(
    /tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*background-image:url\('([^']+)'\)/,
  );
  if (photo) return photo[1];

  const videoThumb = block.match(
    /tgme_widget_message_video_thumb"[^>]*style="[^"]*background-image:url\('([^']+)'\)/,
  );
  return videoThumb?.[1];
}

/**
 * The clip itself. Telegram exposes a direct mp4 on the preview page, so a post whose news
 * IS the footage can be attached as footage rather than described.
 */
function extractVideo(block: string): string | undefined {
  return block.match(/<video[^>]+src="([^"]+\.mp4[^"]*)"/)?.[1];
}

function extractTime(block: string): string {
  const match = block.match(/<time[^>]+datetime="([^"]+)"/);
  return match ? new Date(match[1]).toISOString() : new Date().toISOString();
}

async function fetchChannel(channel: ChannelConfig): Promise<FeedItem[]> {
  const res = await fetch(`https://t.me/s/${channel.handle}`, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`t.me/s/${channel.handle} responded ${res.status}`);
  const html = await res.text();

  const items: FeedItem[] = [];
  for (const match of html.matchAll(MESSAGE_RE)) {
    const [block, postId] = [match[0], match[1]];
    const text = extractText(block);
    if (!text || !looksLikeNews(text)) continue;

    // The first line is the headline; the rest is detail. Channels write this way.
    const [first, ...rest] = text.split("\n").filter(Boolean);

    items.push({
      id: `telegram:${postId}`,
      source: "telegram",
      kind: "news",
      title: first.slice(0, 200),
      summary: rest.join(" ").slice(0, 300),
      url: `https://t.me/${postId}`,
      publishedAt: extractTime(block),
      image: extractPhoto(block),
      videoUrl: extractVideo(block),
      score: 0,
      reasons: [`${channel.label}${channel.language === "ru" ? " · Russian, needs translating" : ""}`],
    });
  }
  return items;
}

export async function fetchTelegram(): Promise<FeedItem[]> {
  // One bad channel must not lose the others.
  const settled = await Promise.allSettled(CHANNELS.map(fetchChannel));
  const items = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (items.length === 0 && settled.every((r) => r.status === "rejected")) {
    throw new Error("all Telegram channels failed");
  }
  return items;
}
