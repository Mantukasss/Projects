import type { Draft, FeedItem } from "./types";

/**
 * Turns a feed item into a ready-to-post draft.
 *
 * Every rule here comes from reading what the accounts that already won this niche
 * actually do (Ozzny_CS2, Culture Crave, brfootball):
 *
 *  1. NO LINK IN THE BODY. X's ranking suppresses posts carrying an external link, and
 *     X's own API prices a link post at $0.20 against $0.015 for a plain one — the
 *     platform is charging 13x for the thing it also demotes. The link goes in reply 1.
 *  2. ALWAYS MEDIA. Every single post in Ozzny's public mirror carries an image. When the
 *     source ships one we attach it; when it doesn't, the quote card becomes the media.
 *  3. LEAD WITH THE HUMAN. "NiKo on the loss: ..." outperforms "Falcons eliminated",
 *     because a face and a feeling get replies and a scoreline gets scrolled past.
 *  4. SHORT. One or two lines, then the emoji. The image carries the detail.
 */

const HANDLE = "@your_handle";

/**
 * The label that opens the post. Taken from what the incumbent actually writes: his posts
 * open "JUST IN:" for a confirmed fact and "RUMOR:" for an unconfirmed one, and he credits
 * no source in the text at all — the screenshot carries the proof.
 *
 * The label is doing real work. It tells a reader in two words how much to trust the line,
 * which is the whole currency of a news account, and it makes being wrong survivable: a
 * rumor that does not pan out costs nothing if it was posted as a rumor.
 */
const CONFIRMED = "JUST IN:";
const UNCONFIRMED = "RUMOR:";

const KIND_EMOJI: Record<FeedItem["kind"], string> = {
  quote: "🎙️",
  roster: "🔁",
  result: "🔥",
  news: "👀",
};

const SOURCE_NAME: Record<FeedItem["source"], string> = {
  hltv: "HLTV",
  liquipedia: "Liquipedia",
  reddit: "r/GlobalOffensive",
  steam: "Valve",
  telegram: "Telegram",
  vlr: "VLR.gg",
};

/** Splits an HLTV interview headline — `zont1x: "we don't yet have..."` — into its parts. */
function splitQuote(title: string): { speaker: string; quote: string } | null {
  const match = title.match(/^([^:]{2,30}):\s*["“](.+)["”]\s*$/);
  if (!match) return null;
  return { speaker: match[1].trim(), quote: match[2].trim() };
}

/** Liquipedia page titles are wiki slugs; the edited section, if any, is in the comment. */
function readWikiEdit(item: FeedItem): { subject: string; section: string; burst: boolean } {
  const section = item.summary.match(/\/\*\s*(.+?)\s*\*\//)?.[1] ?? "";
  return {
    subject: item.title.replace(/_/g, " "),
    section,
    burst: item.reasons.some((reason) => reason.startsWith("burst of")),
  };
}

export function compose(item: FeedItem): Draft {
  const emoji = KIND_EMOJI[item.kind];
  let body: string;

  if (item.kind === "quote") {
    const parsed = splitQuote(item.title);
    // The quote goes on its own line so the eye lands on the words, not the attribution.
    body = parsed
      ? `${parsed.speaker}:\n\n"${parsed.quote}"\n\n${emoji}`
      : `${CONFIRMED} ${item.title}\n\n${emoji}`;
  } else if (item.kind === "roster" && item.source === "liquipedia") {
    // A wiki edit is not an announcement, so it goes out labelled as what it is. Writing
    // it as confirmed news is how a breaking-news account burns the trust it runs on.
    const { subject, section, burst } = readWikiEdit(item);
    body = burst
      ? `${UNCONFIRMED} something is moving around ${subject}.\n\n${item.summary}\n\nNot confirmed — watching for an announcement.`
      : `${UNCONFIRMED} Liquipedia just edited ${subject}` +
        (section ? ` — "${section}"` : "") +
        `\n\nNot confirmed. Watching for an announcement.`;
  } else if (item.source === "telegram") {
    // Telegram carries both, and the channels say which: Russian posts mark rumours with
    // "слух". Anything unresolved stays labelled a rumour rather than promoted to fact.
    const rumoured = /\b(слух|rumou?r|reportedly|apparently)\b/i.test(
      `${item.title} ${item.summary}`,
    );
    body = `${rumoured ? UNCONFIRMED : CONFIRMED} ${item.title}\n\n${emoji}`;
  } else {
    body = `${CONFIRMED} ${item.title}\n\n${emoji}`;
  }

  return {
    body,
    reply: `Source: ${SOURCE_NAME[item.source]}\n${item.url}`,
    image: item.image,
    needsCard: !item.image,
  };
}

/**
 * Rebuilds the draft with the specifics the headline promised.
 *
 * Used after /api/detail resolves an article's team list, so "Closed Qualifier teams
 * announced" becomes a post that actually names them.
 */
export function composeWithTeams(item: FeedItem, teams: string[]): Draft {
  const base = compose(item);
  if (teams.length === 0) return base;

  // A wall of thirty names is not readable on a phone. Name the ones that fit and count
  // the rest honestly, rather than silently truncating.
  const shown = teams.slice(0, 10);
  const remaining = teams.length - shown.length;
  const list = shown.join(", ") + (remaining > 0 ? ` +${remaining} more` : "");

  return {
    ...base,
    body: `${CONFIRMED} ${item.title}\n\n${list}\n\n${KIND_EMOJI[item.kind]}`,
  };
}

/** X counts a post at 280 characters for a free account; Premium raises the ceiling. */
export function postLength(body: string): number {
  return [...body].length;
}

export { HANDLE, SOURCE_NAME, CONFIRMED, UNCONFIRMED, splitQuote };
