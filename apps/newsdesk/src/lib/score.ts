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
  steam: 34, // Valve announcing its own game is as authoritative as it gets
  x: 40, // first-party words, already attributable to the handle that said them
  youtube: 38, // an on-the-record interview: the quote source, and nobody has transcribed it
  twitch: 36, // a broadcast quote exists nowhere else until someone writes it up
  telegram: 32, // where the scene talks first, and where a Valve build change shows up
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

  // Already posted by an incumbent. Heavily demoted rather than dropped: it is sometimes
  // still worth covering, but it is never worth covering FIRST, and the feed exists to
  // surface what is still yours to break.
  const scoopedPenalty = item.scooped ? 55 : 0;
  if (item.scooped) reasons.push(`already posted by ${item.scooped}`);

  // A headline promising a list it does not contain is not postable until the detail is
  // pulled in, so it should not sit at the top of the feed looking ready.
  const incompletePenalty = item.incomplete ? 20 : 0;
  if (item.incomplete === "list") reasons.push("names nobody — needs the list");
  if (item.incomplete === "number") reasons.push("claims a record — needs the figure");

  return {
    ...item,
    score: Math.round(
      freshness + source + kind + burst + heatHits * 9 - mediaPenalty - scoopedPenalty - incompletePenalty,
    ),
    reasons,
  };
}

/** Same story from two sources is one story. Keeps the highest-scoring copy. */
/**
 * Collapses the same story from several sources into one card — by MERGING, not discarding.
 *
 * It used to keep whichever copy scored higher and throw the rest away, which lost real
 * information. HLTV published "Krabeni pens contract extension with FUT" at 13:49:00 with a
 * standfirst, a photo and an article URL that /api/detail can read; @HLTVorg tweeted the
 * same headline 37 seconds later with an empty summary and no photo. The tweet scored higher
 * on freshness and won, so the card lost the summary, the picture and the readable link.
 *
 * So: the higher score still decides the RANKING and the headline, and everything it is
 * missing is filled in from the copy it beat. The timestamp becomes the EARLIEST of the two,
 * because that is when the story actually broke — a later copy of the same news does not
 * make it newer, and treating it as newer is how a feed flatters itself about being first.
 */
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
    if (!existing) {
      seen.set(key, item);
      continue;
    }
    const [winner, loser] = item.score > existing.score ? [item, existing] : [existing, item];
    seen.set(key, {
      ...winner,
      summary: winner.summary || loser.summary,
      image: winner.image ?? loser.image,
      videoUrl: winner.videoUrl ?? loser.videoUrl,
      teamPage: winner.teamPage ?? loser.teamPage,
      playerName: winner.playerName ?? loser.playerName,
      /**
       * An HLTV article beats a tweet about it as the link, whichever scored higher: it is
       * the thing /api/detail can actually read for the teams and the numbers a headline
       * promised, and it is what "Verify" should open.
       */
      url: winner.source === "hltv" ? winner.url : loser.source === "hltv" ? loser.url : winner.url,
      source: winner.source === "hltv" || loser.source !== "hltv" ? winner.source : loser.source,
      publishedAt:
        Date.parse(loser.publishedAt) < Date.parse(winner.publishedAt)
          ? loser.publishedAt
          : winner.publishedAt,
      // Both reasons, so the card can say it was carried in two places.
      reasons: [...new Set([...winner.reasons, ...loser.reasons])],
    });
  }
  return [...seen.values()];
}
