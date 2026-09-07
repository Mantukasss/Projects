import type { Draft, FeedItem } from "./types";
import { isForeignScript } from "./language";
import { brandOf } from "./teams";

/**
 * Turns a feed item into a ready-to-post draft.
 *
 * THIS FORMAT IS NOT INVENTED. It is read off @Ozzny_CS2 and @cs2files — eleven of their
 * posts, fetched and studied — and every rule below names the post it came from. What they
 * do turned out to be narrower and plainer than what this file used to emit.
 *
 * THE SHAPE, in all eleven:
 *
 *     {a sentence saying who did or said what}{one emoji, optional}
 *                                        <- blank line
 *     {the quote, or the background paragraph, or a > list}
 *                                        <- blank line
 *     {one closing fact}
 *
 * WHAT THEY NEVER DO, each of which this file used to:
 *
 *  - NO "JUST IN:" or "RUMOR:" prefix. Zero of eleven. The opening line is a SENTENCE that
 *    states the news — "ruggah has officially retired from coaching after more than a
 *    decade in Counter-Strike" — or an attribution — "donk on what makes tN1R so good:".
 *    A label in front of a headline is what an aggregator writes; a sentence is what a
 *    publication writes, and the difference is visible at a glance in a timeline.
 *  - NO lone emoji on its own line at the end. Ozzny closes the LEAD line with one emoji,
 *    inline (five of five: 🥶 😭 😭 🇵🇹‼️ 💀); cs2files mostly uses none (one of five). An
 *    emoji parked on its own line is a tell that a script wrote the post.
 *  - NO "via @handle" in the body. Neither credits a source in the text, ever. This file
 *    said so in a comment and then appended one anyway. Attribution is reply 1.
 *  - NO link in the body. X demotes posts that send people off-platform.
 *
 * WHAT THEY ALWAYS DO:
 *
 *  - Media on every post. Never a bare text post, in any of the eleven.
 *  - Curly quotation marks around speech.
 *  - "> " as the bullet for a list of two or more (Ozzny, twice). Never for a single line.
 *  - Lead with the human. "donk after winning BLAST Porto" beats "Spirit win BLAST Porto".
 */

/**
 * The double-exclamation, kept but repositioned.
 *
 * Ozzny writes it INLINE at the end of a headline — "Spirit are your BLAST Porto CHAMPIONS
 * 🇵🇹‼️" — not on a line of its own. It reads as a shout there and as punctuation debris
 * anywhere else.
 */
const MARK = "\u203C\uFE0F";

/**
 * The emoji that closes a lead line when the write-up did not choose one.
 *
 * Ozzny's picks — 😭 for a player being candid, 💀 for someone getting humiliated, 🥶 for a
 * number nobody expected — are judgements about tone that need the story, so the model picks
 * from the text and these are only the floor. Deliberately dull: a wrong emoji reads worse
 * than a plain one, and 👀 is never wrong on a piece of news.
 */
const KIND_EMOJI: Record<FeedItem["kind"], string> = {
  quote: "👀",
  roster: "👀",
  result: "🏆",
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
  twitch: "@Twitch",
  youtube: "@HLTVorg",
  steam: "@CounterStrike",
  vlr: "@VLRdotgg",
};

const SOURCE_NAME: Record<FeedItem["source"], string> = {
  hltv: "HLTV",
  liquipedia: "Liquipedia",
  reddit: "r/GlobalOffensive",
  steam: "Valve",
  telegram: "Telegram",
  twitch: "Twitch",
  youtube: "YouTube",
  x: "X",
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

/**
 * Assembles the three-block post both accounts write: lead, body, kicker.
 *
 * Blank lines between blocks and nowhere else. That gap is what makes a post scannable in a
 * timeline, and it is the one piece of formatting every single studied post shares.
 */
function layout(lead: string, blocks: (string | string[])[]): string {
  const parts = [lead.trim()];
  for (const block of blocks) {
    // An array is a list, and a list gets Ozzny's "> " bullets — but only at two or more.
    // One "> " line is not a list, it is a stray character.
    if (Array.isArray(block)) {
      if (block.length >= 2) parts.push(block.map((line) => `> ${line}`).join("\n"));
      else if (block.length === 1) parts.push(block[0]);
    } else if (block.trim()) {
      parts.push(block.trim());
    }
  }
  return parts.join("\n\n");
}

/**
 * Closes the lead line with an emoji, the way Ozzny does — inline, never on its own line.
 *
 * A title win also gets the double-exclamation, because that is precisely where he puts it:
 * "Spirit are your BLAST Porto CHAMPIONS 🇵🇹‼️". Nowhere else — on an ordinary line it reads
 * as punctuation debris rather than as a shout.
 */
function close(lead: string, emoji: string, shout = false): string {
  const text = lead.trim();
  const tail = shout ? `${emoji}${MARK}` : emoji;
  if (tail) return `${text} ${tail}`;
  /**
   * No emoji means the lead is a sentence, and cs2files ends those with a full stop —
   * "ruggah has officially retired from coaching after more than a decade in Counter-Strike."
   * A dangling clause with no terminator is the difference between a sentence and a headline,
   * and headlines are what this format is trying not to write. A lead already ending in
   * punctuation — most often the colon of "donk on tN1R:" — is left alone.
   */
  return /[.!?:;,\u201D"')\]]$/.test(text) ? text : `${text}.`;
}

export function compose(item: FeedItem): Draft {
  const emoji = KIND_EMOJI[item.kind];
  const shout = item.kind === "result";
  let body: string;

  if (item.kind === "quote") {
    const parsed = splitQuote(item.title);
    /**
     * "donk on what makes tN1R so good:" then the words. cs2files' exact shape, and the
     * reason it works is that the lead tells you whether the quote is worth reading before
     * you read it. Without a topic there is only the name, which is still their fallback.
     */
    body = parsed
      ? layout(`${parsed.speaker}:`, [`\u201C${parsed.quote}\u201D`])
      : layout(close(item.title, emoji, shout), []);
  } else if (item.kind === "roster" && item.source === "liquipedia") {
    /**
     * A wiki edit is not an announcement and must not read like one — but the hedge is a
     * SENTENCE now, not a "RUMOR:" label. Same honesty, and it reads like a person wrote it.
     */
    const { subject, section, burst } = readWikiEdit(item);
    body = burst
      ? layout(`Something is moving around ${subject} 👀`, [
          item.summary,
          "Nothing announced yet — this is the wiki, not the org.",
        ])
      : layout(
          `Liquipedia just edited ${subject}${section ? ` — \u201C${section}\u201D` : ""} 👀`,
          ["Nothing announced yet — this is the wiki, not the org."],
        );
  } else if (item.source === "steam") {
    // Valve titles every patch "Counter-Strike 2 Update", which tells a reader nothing, so
    // the change leads and the title never appears.
    const detail = firstSentences(item.summary, 220);
    body = layout(close(item.title, emoji, shout), [detail]);
  } else if (item.source === "telegram") {
    // The channels mark rumours with "слух". An unresolved one keeps its hedge, in prose.
    const rumoured = /\b(слух|rumou?r|reportedly|apparently)\b/i.test(
      `${item.title} ${item.summary}`,
    );
    body = layout(close(item.title, emoji, shout), [
      rumoured ? "Reported, not confirmed." : "",
    ]);
  } else {
    body = layout(close(item.title, emoji, shout), []);
  }

  /**
   * No credit in the body, at all.
   *
   * Neither studied account credits a source in the post text — not once in eleven posts.
   * This file's own header said so and the code appended "via @HLTVorg" anyway. The
   * attribution belongs in reply 1, where it costs the post nothing.
   */
  const credited = body;

  const { options, needsCard } = planMedia(item);

  return {
    body: credited,
    reply: sourceReply(item),
    images: options,
    needsCard,
  };
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
export function planMedia(
  item: FeedItem,
  /**
   * Everyone the write-up found named in the text. A quote about donk and s1mple wants
   * photographs of donk and s1mple — the two faces in the story, which is the pairing the
   * accounts worth copying use — not the speaker beside a team crest.
   */
  people: string[] = [],
): {
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

  /**
   * The aggregator's own graphic, kept but never leading.
   *
   * A channel's quote card is watermarked with its handle and logo, so posting it is
   * republishing their asset under your name — the thing that separates an account people
   * follow from one they recognise as a mirror. It stays available because it is sometimes
   * the only picture of a moment, and a human can see when that is worth it; it goes last
   * and says why.
   */
  /**
   * A picture of Russian text is never offered, at any position.
   *
   * It was kept as a last resort on the reasoning that it is sometimes the only picture of
   * a moment. It is not: it is a graphic the audience cannot read, wearing another outlet's
   * watermark, and it will not be posted — so listing it only costs a slot and a decision.
   * The story still gets used; it is retold in English with our own pictures.
   */
  const unusable = foreign || item.source === "telegram";
  const sourceImage = !unusable && item.image ? { url: item.image, label: "From the source" } : null;

  if (sourceImage) options.push(sourceImage);

  // The item itself, which for a skin post is the entire story. First, because nothing
  // else in the list is more specific than a picture of the thing being talked about.
  if (item.itemName) {
    options.push({
      url: `/api/item?name=${encodeURIComponent(item.itemName)}`,
      label: item.itemName,
    });
  }

  // Named people next, in the order the write-up found them: the speaker leads, then
  // whoever the quote is about. Falls back to the nickname read off the headline.
  const named = people.length > 0 ? people : item.playerName ? [item.playerName] : [];
  for (const person of named.slice(0, 4)) {
    options.push({
      url: `/api/photo?name=${encodeURIComponent(person)}${wiki}`,
      label: person,
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

export interface Writeup {
  /** Which shape the source suited: someone's words, or something that happened. */
  kind: "quote" | "story";
  /**
   * The opening SENTENCE — who, and what this is about — in our own words.
   *
   * This replaces the old "hook", which put the speaker's boldest line in quotation marks
   * on line one. Neither studied account does that: they say what the quote is about and
   * then let you read it. "magixx revealed the strategy he used to reset after MOUZ did the
   * comeback on Mirage"; "donk on what makes tN1R so good:". The lead is the promise and
   * the quote is the payoff, and leading with the payoff spends it.
   */
  lead: string;
  /** One emoji closing the lead line, chosen from the story. Empty for a flat one. */
  emoji: string;
  speaker: string;
  /** The words themselves, verbatim — never regenerated, so the exact part cannot drift. */
  quote: string;
  /** For a story: the background paragraph that gives the news its weight. */
  background: string;
  /** The closing fact — what it means now, or the number that proves the lead. */
  context: string;
  /** Two or more parallel items, rendered as Ozzny's "> " list. */
  list: string[];
  /** Everyone named in the text, speaker first — each is a photo the post can attach. */
  people: string[];
}

/**
 * The post, in the studied shape: lead, then the words or the background, then the kicker.
 *
 * Curly quotation marks throughout — both accounts use them, and straight quotes are one of
 * the small tells that a script wrote the post.
 */
export function composeFromWriteup(item: FeedItem, writeup: Writeup): Draft {
  const base = compose(item);
  /**
   * The model's emoji, including its decision NOT to use one.
   *
   * There used to be a `|| KIND_EMOJI[...]` fallback here, which meant the prompt asked for
   * an empty string when none fit and then had that answer overridden — every post came out
   * wearing 👀 whatever it was about. cs2files leaves the emoji off four posts in five. The
   * fallback belongs on a bare headline, which has nobody to make the judgement.
   */
  const lead = close(writeup.lead, writeup.emoji, item.kind === "result");

  const body =
    writeup.kind === "quote"
      ? layout(lead, [
          writeup.quote ? `\u201C${writeup.quote}\u201D` : "",
          writeup.list,
          writeup.context,
        ])
      : layout(lead, [writeup.background, writeup.list, writeup.context]);

  return { ...base, body };
}

export function composeWithDetail(
  item: FeedItem,
  detail: { teams?: string[]; keyFact?: string | null },
): Draft {
  const base = compose(item);
  const teams = detail.teams ?? [];
  const lead = close(item.title, KIND_EMOJI[item.kind], item.kind === "result");

  // A record story mentions plenty of teams in passing; listing them would be nonsense.
  // The promise the headline broke decides which detail repairs it.
  if (item.incomplete === "number" && detail.keyFact) {
    return { ...base, body: layout(lead, [detail.keyFact]) };
  }

  if (teams.length > 0 && item.incomplete !== "number") {
    /**
     * The qualified teams as Ozzny's "> " list rather than a comma run-on. A list reads as
     * a scoreboard; a run-on reads as a paragraph nobody finishes.
     *
     * Ten and then a count: thirty names is unreadable on a phone, and truncating silently
     * is worse than saying how many were left out.
     */
    const shown = teams.slice(0, 10);
    const remaining = teams.length - shown.length;
    return {
      ...base,
      body: layout(lead, [shown, remaining > 0 ? `+${remaining} more` : ""]),
    };
  }

  if (detail.keyFact) {
    return { ...base, body: layout(lead, [detail.keyFact]) };
  }

  return base;
}

/**
 * The first reply, crediting where the story actually came from.
 *
 * Aggregators are not origins. A Telegram channel reposting an interview is where we read
 * it, not where it happened, and crediting only the channel takes credit the interviewer
 * earned — which is both unfair and the thing that gets an account called a content thief.
 * When the source text carries a link out to the original — a YouTube interview, an
 * article — that link leads and the channel follows as "found via".
 */
function sourceReply(item: FeedItem): string {
  // An X post is already attributed to a handle, and that handle is what verifies it.
  if (item.source === "x") {
    const handle = item.url.match(/x\.com\/([^/]+)\//)?.[1];
    return handle ? `Source: @${handle}\n${item.url}` : `Source: X\n${item.url}`;
  }

  const origin = `${item.title} ${item.summary}`.match(
    /https?:\/\/(?!t\.me\b)[^\s"'<>)]+/i,
  )?.[0];

  if (origin) {
    return `Source: ${origin}\nFound via ${SOURCE_NAME[item.source]}: ${item.url}`;
  }
  /**
   * A handle where the source has one, the plain name otherwise.
   *
   * A mention costs nothing — X keeps the reader on the platform, unlike a link — and it
   * buys two things: a lifted scoop stops looking lifted, and the credited account
   * sometimes replies, which is reach.
   */
  const handle = SOURCE_HANDLE[item.source];
  return `Source: ${handle ?? SOURCE_NAME[item.source]}\n${item.url}`;
}

/** X counts a post at 280 characters for a free account; Premium raises the ceiling. */
export function postLength(body: string): number {
  return [...body].length;
}

export { SOURCE_NAME, splitQuote };
