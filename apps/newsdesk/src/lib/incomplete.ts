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

export function markIncomplete(item: FeedItem): FeedItem {
  // A quote is never an announcement — the speaker's words are the whole content, and any
  // list-ish word inside them is theirs, not a promise the post is failing to keep.
  if (item.kind === "quote") return item;
  // Only HLTV articles can be enriched, so flagging anything else just blocks a post with
  // no way to unblock it.
  if (item.source !== "hltv") return item;
  if (!PROMISES_A_LIST.test(item.title)) return item;
  if (carriesSpecifics(item)) return item;
  return { ...item, incomplete: true };
}
