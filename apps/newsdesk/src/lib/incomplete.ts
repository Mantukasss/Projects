import type { FeedItem } from "./types";

/**
 * Flags a headline that promises specifics the post does not carry.
 *
 * "PGL Masters Bucharest 2026 Closed Qualifier teams announced" names no teams. Posting it
 * is worse than not posting: the reader came for the list, found none, and learns that this
 * account's posts are not worth opening. The fix is to fetch the list, not to soften the
 * wording — so this marks the item and the card refuses to hand over the draft until the
 * detail is loaded.
 */
/**
 * Every branch requires the announcing verb, not just the noun. An earlier version matched
 * a bare "results" and flagged the quote `zont1x: "We don't yet have significant results
 * to say that we are the best"` as an announcement with a missing list — a false positive
 * that blocks a perfectly good post, which is the expensive direction to be wrong in.
 */
const PROMISES_A_LIST =
  /\b(teams?|lineups?|line-?ups?|rosters?|participants|groups?|brackets?|standings|seeding|qualifiers?)\s+(announced|revealed|confirmed|drawn|unveiled|set)\b|\b(announces?|reveals?|confirms?)\s+(the\s+)?(teams?|lineups?|rosters?|participants|groups?)\b/i;

/**
 * Headlines that claim a record, a first or a most, and are worthless without the figure.
 * "dako sets new CS2 regulation kill record" is the same failure as the qualifier post: the
 * reader came for the number — it was 40 kills in 24 rounds, beating 39 — and got a
 * sentence that could describe any record ever set.
 */
const PROMISES_A_NUMBER =
  /\b(record|most|fastest|highest|longest|biggest|milestone|first ever|all-?time)\b/i;

/**
 * True when the post already names things, so there is nothing missing to go and fetch.
 *
 * A real list reads as comma-separated proper nouns — "Falcons, Spirit, FURIA". An earlier
 * version also accepted anything matching a scoreline, which silently swallowed
 * "The closed qualifiers will run from September 9-13" and let the emptiest post in the
 * feed through unflagged. Dates look exactly like scores, so that test is gone; a genuine
 * result post is classified `result` and never reaches here anyway.
 */
function carriesSpecifics(item: FeedItem): boolean {
  const text = `${item.title} ${item.summary}`;
  const listed = text.match(/[A-Z][\w.]*(?:\s+[A-Z][\w.]*)*\s*,/g) ?? [];
  return listed.length >= 2;
}

/**
 * True when the post already states the figure its headline claims.
 *
 * Naively testing for any digit does not work: "dako sets new CS2 regulation kill record"
 * contains a 2, inside the name of the game, and so counted as already having its number
 * while saying nothing about the 40 kills that were the entire story. Game names, years and
 * event editions are stripped before looking, and what remains has to read like a quantity.
 */
function carriesANumber(item: FeedItem): boolean {
  const text = `${item.title} ${item.summary}`
    .replace(/\bCS\s?2\b|\bCS:?GO\b|\bCS\s?1\.6\b/gi, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\bS\d+\b/gi, "");
  // A quantity is a number with something counted, or any multi-digit figure.
  return /\b\d+\s*(?:kills?|rounds?|maps?|wins?|games?|matches|points?|hours?|%|k\b)|\$\s?\d|\b\d{2,}\b/i.test(
    text,
  );
}

export function markIncomplete(item: FeedItem): FeedItem {
  // A quote is never an announcement — the speaker's words are the whole content, and any
  // list-ish word inside them is theirs, not a promise the post is failing to keep.
  if (item.kind === "quote") return item;
  // Only HLTV articles can be enriched, so flagging anything else just blocks a post with
  // no way to unblock it.
  if (item.source !== "hltv") return item;
  if (PROMISES_A_LIST.test(item.title) && !carriesSpecifics(item)) {
    return { ...item, incomplete: "list" };
  }
  if (PROMISES_A_NUMBER.test(item.title) && !carriesANumber(item)) {
    return { ...item, incomplete: "number" };
  }
  return item;
}
