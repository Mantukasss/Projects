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

/**
 * The X account behind a source, for a "via @handle" credit.
 *
 * A handle is not a link: X demotes posts that send people off the platform, and a mention
 * keeps them on it. So the credit costs nothing, and it buys two things — it stops a
 * lifted scoop looking lifted, and the credited account sometimes replies, which is reach.
 *
 * Only for sources that ARE an account someone can go and read. Liquipedia is a wiki and
 * Reddit is a forum: crediting them by handle would be noise, and their attribution belongs
 * in reply 1 like everything else.
 */
const SOURCE_HANDLE: Partial<Record<FeedItem["source"], string>> = {
  hltv: "@HLTVorg",
  steam: "@CounterStrike",
  vlr: "@VLRdotgg",
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

/**
 * Counter-Strike 2's store artwork, from Steam's own CDN.
 *
 * A patch-notes post goes out as two images: the notes themselves, and the game. One image
 * of dense text scrolls past; the pairing reads as an event. Valve serves this publicly for
 * app 730 and it never changes, so it costs nothing to attach.
 */
const CS2_ARTWORK =
  "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/capsule_616x353.jpg";

/**
 * The mark that rides on a VALORANT post's second slot, so it gets the team's badge plus a
 * game mark — the same one-is-a-caption, two-is-an-event reasoning as a CS2 update.
 *
 * This is VLR.gg's logo, not Riot's. Riot serves its artwork from a CMS with opaque,
 * rotating asset paths, and shipping a guessed URL would mean posts going out with a broken
 * image; this one is verified to answer. Swap it if a stable Riot asset URL turns up.
 */
const VALORANT_ARTWORK = "https://www.vlr.gg/img/vlr/logo_header.png";

/** Takes whole sentences up to a budget, so a post never ends mid-word. */
function firstSentences(text: string, budget: number): string {
  if (!text) return "";
  let out = "";
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (out && (out + " " + sentence).length > budget) break;
    out = out ? `${out} ${sentence}` : sentence;
    if (out.length >= budget) break;
  }
  return out.length > budget ? `${out.slice(0, budget).replace(/\s+\S*$/, "")}…` : out;
}

/** Valve's own posts about the game — the ones that deserve the two-image treatment. */
function isGameUpdate(item: FeedItem): boolean {
  return (
    item.source === "steam" ||
    (item.source === "telegram" && /\b(update|обнов|сборк|build)\b/i.test(item.title))
  );
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
  } else if (item.source === "steam") {
    // Valve titles every patch "Counter-Strike 2 Update", which is a headline that tells a
    // reader nothing. What changed is in the body, so the body leads and the title frames.
    const detail = firstSentences(item.summary, 200);
    body = detail
      ? `${CONFIRMED} ${item.title}\n\n${detail}\n\n${emoji}`
      : `${CONFIRMED} ${item.title}\n\n${emoji}`;
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

  const handle = SOURCE_HANDLE[item.source];
  // The credit rides on the emoji line rather than taking a line of its own, so it never
  // costs the post a line of substance.
  const credited = handle ? `${body} via ${handle}` : body;

  return {
    body: credited,
    reply: `Source: ${SOURCE_NAME[item.source]}\n${item.url}`,
    image: item.image,
    secondImage: item.source === "vlr" ? VALORANT_ARTWORK : isGameUpdate(item) ? CS2_ARTWORK : undefined,
    needsCard: !item.image,
  };
}

/**
 * Rebuilds the draft with the specifics the headline promised.
 *
 * Used after /api/detail resolves an article's team list, so "Closed Qualifier teams
 * announced" becomes a post that actually names them.
 */
export function composeWithDetail(
  item: FeedItem,
  detail: { teams?: string[]; keyFact?: string | null },
): Draft {
  const base = compose(item);
  const teams = detail.teams ?? [];

  // A record story mentions plenty of teams in passing; listing them would be nonsense.
  // The promise the headline broke decides which detail repairs it.
  if (item.incomplete === "number" && detail.keyFact) {
    return {
      ...base,
      body: `${CONFIRMED} ${item.title}\n\n${detail.keyFact}\n\n${KIND_EMOJI[item.kind]}`,
    };
  }

  if (teams.length > 0 && item.incomplete !== "number") {
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

  if (detail.keyFact) {
    // The figure IS the story for a record post, so it leads and the headline supports it.
    return {
      ...base,
      body: `${CONFIRMED} ${item.title}\n\n${detail.keyFact}\n\n${KIND_EMOJI[item.kind]}`,
    };
  }

  return base;
}

/** X counts a post at 280 characters for a free account; Premium raises the ceiling. */
export function postLength(body: string): number {
  return [...body].length;
}

export { HANDLE, SOURCE_NAME, CONFIRMED, UNCONFIRMED, splitQuote };
