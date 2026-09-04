import type { Draft, FeedItem } from "./types";
import { brandOf } from "./teams";

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

  const { options, needsCard } = planMedia(item);

  return {
    body: credited,
    reply: `Source: ${SOURCE_NAME[item.source]}\n${item.url}`,
    images: options,
    needsCard,
  };
}

/** Text in an alphabet this account's audience does not read. */
function isForeignScript(text: string): boolean {
  return /[\u0400-\u04FF]/.test(text);
}

export interface MediaOption {
  url: string;
  label: string;
  /** A clip rather than a still — it downloads and uploads as video, not as an image. */
  video?: boolean;
  /** Foreign-language screenshots are offered but never pre-selected. */
  caution?: string;
  /**
   * A team crest, which is composed onto the org's brand colour rather than shown raw.
   * Carries the colour so the tile does not have to look it up again.
   */
  crest?: { brand: string | null };
}

/**
 * Offers everything this post could attach, best first, and picks nothing.
 *
 * An earlier version chose two and discarded the rest — including the source screenshot on
 * every Russian item — which meant a run of posts all wearing the same game capsule. The
 * judgement of which picture tells the story is not one a rule can make from a headline, so
 * the options are laid out and the choice is left to the person posting.
 *
 * Order is by how specific each is to this story: the source's own photo, then the player,
 * then their team, then the game. The game mark is last because it always resolves and so
 * would otherwise crowd out everything better.
 */
export function planMedia(item: FeedItem): {
  options: MediaOption[];
  needsCard: boolean;
} {
  const foreign = isForeignScript(`${item.title} ${item.summary}`);
  const wiki = item.source === "vlr" ? "&wiki=valorant" : "";
  const options: MediaOption[] = [];

  // The clip first. When the news IS the footage — "what are they doing at the bootcamp" —
  // every still in the list is a description of the thing rather than the thing.
  if (item.videoUrl) {
    options.push({ url: item.videoUrl, label: "Video from the source", video: true });
  }

  if (item.image) {
    options.push({
      url: item.image,
      label: "From the source",
      // Kept, not dropped: it is often the best picture in the post, and whether the
      // Russian text matters depends on the picture — which only a human can see.
      caution: foreign ? "Contains Russian text" : undefined,
    });
  }

  // The item itself, which for a skin post is the entire story. First, because nothing
  // else in the list is more specific than a picture of the thing being talked about.
  if (item.itemName) {
    options.push({
      url: `/api/item?name=${encodeURIComponent(item.itemName)}`,
      label: item.itemName,
    });
  }

  if (item.playerName) {
    options.push({
      url: `/api/photo?name=${encodeURIComponent(item.playerName)}${wiki}`,
      label: item.playerName,
    });
  }

  if (item.teamPage) {
    options.push({
      url: `/api/logo?title=${encodeURIComponent(item.teamPage)}${wiki}`,
      label: item.teamPage,
      crest: { brand: brandOf(item.teamPage) },
    });
  }

  options.push({
    url: item.source === "vlr" ? VALORANT_ARTWORK : CS2_ARTWORK,
    label: item.source === "vlr" ? "VALORANT" : "Counter-Strike 2",
  });

  return {
    options,
    // The card carries the words, and is what a foreign-script post needs so the story
    // reaches the reader in a language they read.
    needsCard: foreign || !item.image,
  };
}

/**
 * Rebuilds the draft with the specifics the headline promised.
 *
 * Used after /api/detail resolves an article's team list, so "Closed Qualifier teams
 * announced" becomes a post that actually names them.
 */
export interface Writeup {
  lead: string;
  quote: string;
  context: string;
}

/**
 * The post in the shape the incumbents use: a lead that says what the quote means, the
 * quote itself, then a line of supporting fact.
 *
 * Curly quotation marks on purpose — every account in this scene uses them, and straight
 * quotes are one of the small tells that a post came out of a script.
 */
export function composeFromWriteup(item: FeedItem, writeup: Writeup): Draft {
  const base = compose(item);
  const parts = [writeup.lead];
  if (writeup.quote) parts.push(`\u201C${writeup.quote}\u201D`);
  if (writeup.context) parts.push(writeup.context);
  parts.push(KIND_EMOJI[item.kind]);

  const handle = SOURCE_HANDLE[item.source];
  return {
    ...base,
    // The credit gets its own line here, the way the accounts worth copying place it.
    body: parts.join("\n\n") + (handle ? `\n\nSource: ${handle}` : ""),
  };
}

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
