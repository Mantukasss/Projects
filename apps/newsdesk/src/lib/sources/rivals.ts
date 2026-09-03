import { USER_AGENT, decodeEntities } from "./fetchXml";

/**
 * Reads what the incumbent CS2 news accounts have ALREADY posted, so the feed can tell you
 * when you are late.
 *
 * This is not a content source and nothing here is ever shown as a post. Its only job is to
 * answer the one question a breaking-news account lives on: has this already gone out? A
 * story Ozzny published forty minutes ago is not a scoop, and posting it anyway is how an
 * account reads as a copy of a better one.
 *
 * Ozzny mirrors his X account to a public Telegram channel, which is readable with no API
 * and no key — so the check costs one request.
 */
const RIVAL_CHANNELS = [
  { handle: "ozznycs2news", account: "@Ozzny_CS2" },
];

export interface RivalPost {
  account: string;
  text: string;
  at: number;
}

export async function fetchRivalPosts(): Promise<RivalPost[]> {
  const settled = await Promise.allSettled(
    RIVAL_CHANNELS.map(async (rival) => {
      const res = await fetch(`https://t.me/s/${rival.handle}`, {
        headers: { "User-Agent": USER_AGENT },
        next: { revalidate: 120 },
      });
      if (!res.ok) throw new Error(`${rival.handle} responded ${res.status}`);
      const html = await res.text();

      const posts: RivalPost[] = [];
      for (const match of html.matchAll(
        /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
      )) {
        const text = decodeEntities(match[1].replace(/<[^>]+>/g, " "))
          .replace(/\s+/g, " ")
          .trim();
        if (text) posts.push({ account: rival.account, text, at: Date.now() });
      }
      return posts;
    }),
  );

  return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

/** Words too common in CS coverage to indicate two posts are the same story. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "have", "has", "will",
  "after", "their", "they", "team", "cs2", "counter", "strike", "just", "his",
  "her", "who", "not", "but", "are", "was", "were", "been", "into", "over",
]);

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word)),
  );
}

/**
 * Returns the rival account that already covered this, or null.
 *
 * Deliberately a high bar. A false positive hides a genuine scoop, which costs far more
 * than the occasional duplicate — so it needs a real overlap of distinctive words, not a
 * shared topic.
 */
export function alreadyCovered(
  title: string,
  summary: string,
  rivals: RivalPost[],
): string | null {
  const mine = significantWords(`${title} ${summary}`);
  if (mine.size < 3) return null;

  for (const rival of rivals) {
    const theirs = significantWords(rival.text);
    let shared = 0;
    for (const word of mine) if (theirs.has(word)) shared += 1;

    // Two thirds of the distinctive words, and at least three of them.
    if (shared >= 3 && shared / mine.size >= 0.66) return rival.account;
  }
  return null;
}
