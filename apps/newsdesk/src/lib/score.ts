import type { FeedItem } from "./types";

/**
 * Ranks the feed by "how much would posting this right now be worth".
 *
 * Freshness dominates everything else, because a breaking-news account's only product is
 * being early — an hour-old story is worth a fraction of a five-minute-old one no matter
 * how good it is. The other terms only reorder items of similar age.
 */

/** How much we trust the source to be both accurate and citable. */
const SOURCE_WEIGHT: Record<FeedItem["source"], number> = {
  hltv: 30,
  liquipedia: 26, // fast and often first, but unverified
  vlr: 20,
  reddit: 12, // early warning, rarely citable on its own
};

/** Kinds that reliably out-engage a plain news item. */
const KIND_WEIGHT: Record<FeedItem["kind"], number> = {
  quote: 22,
  roster: 25,
  result: 14,
  news: 0,
};

/** Words that mark a story people argue about — arguments are replies, replies are reach. */
const HEAT = [
  /\bban(ned|ning)?\b/i,
  /\bcheat(ing|er)?\b/i,
  /\bretire(s|ment)?\b/i,
  /\bleaves?\b/i,
  /\bbenched?\b/i,
  /\bdisband/i,
  /\brecord\b/i,
  /\bfirst ever\b/i,
  /\bupset\b/i,
  /\beliminat/i,
];

const HALF_LIFE_MINUTES = 45;

export function scoreItem(item: FeedItem): FeedItem {
  // Sources may arrive with their own reasons (a Liquipedia burst, say). Keep them.
  const reasons: string[] = [...item.reasons];

  const ageMinutes = Math.max(0, (Date.now() - Date.parse(item.publishedAt)) / 60000);
  // Exponential decay: full value when new, half at 45 minutes, near zero past a few hours.
  const freshness = 100 * Math.pow(0.5, ageMinutes / HALF_LIFE_MINUTES);
  if (ageMinutes < 15) reasons.push("under 15 min old");
  else if (ageMinutes < 60) reasons.push(`${Math.round(ageMinutes)} min old`);

  const source = SOURCE_WEIGHT[item.source];
  const kind = KIND_WEIGHT[item.kind];
  if (kind > 0) reasons.push(`${item.kind} format`);

  // A multi-page Liquipedia burst is the strongest lead this feed produces, and it is
  // worth more than any keyword — several pages moving at once is a roster shuffle.
  const burst = item.reasons.some((reason) => reason.startsWith("burst of")) ? 34 : 0;

  const haystack = `${item.title} ${item.summary}`;
  const heatHits = HEAT.filter((pattern) => pattern.test(haystack)).length;
  if (heatHits > 0) reasons.push(`${heatHits} high-engagement term${heatHits > 1 ? "s" : ""}`);

  // An item with no image needs a card generated before it can go out — a small tax,
  // not a veto, since the card takes one tap.
  const mediaPenalty = item.image ? 0 : 6;
  if (!item.image) reasons.push("no source image — card needed");

  return {
    ...item,
    score: Math.round(freshness + source + kind + burst + heatHits * 9 - mediaPenalty),
    reasons,
  };
}

/** Same story from two sources is one story. Keeps the highest-scoring copy. */
export function dedupe(items: FeedItem[]): FeedItem[] {
  const seen = new Map<string, FeedItem>();
  for (const item of items) {
    const key = item.title
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 3)
      .slice(0, 6)
      .join(" ");
    const existing = seen.get(key);
    if (!existing || item.score > existing.score) seen.set(key, item);
  }
  return [...seen.values()];
}
