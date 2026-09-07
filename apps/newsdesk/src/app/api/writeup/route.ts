import { NextResponse } from "next/server";
import { LlmError, ask, hasLlmKey, parseJson } from "@/lib/llm";
import { correctNames, glossaryLines } from "@/lib/glossary";

export const runtime = "nodejs";

/**
 * Writes the post in the shape @Ozzny_CS2 and @cs2files actually use.
 *
 * Eleven of their posts were fetched and read to get this, and the shape is narrower than
 * what this prompt used to ask for. Every post is three blocks:
 *
 *     donk on what makes tN1R so good:
 *
 *     "tN1R is an insane aimer, but his biggest strength is how well he understands space
 *     on the map. He moves really well and constantly finds gaps."
 *
 *     donk believes game sense and movement are what really separate the top players.
 *
 * THE CHANGE FROM THE OLD PROMPT, and why: it used to ask for a "hook" — the speaker's
 * boldest line, in quotation marks, ON LINE ONE. Neither account does that, in any post.
 * They say what the quote is ABOUT and then let you read it. The lead is a promise and the
 * quote is the payoff; opening with the payoff spends it, and the reader has no reason to
 * keep going. So the model now writes a LEAD SENTENCE in its own words, and the quote sits
 * underneath, untouched.
 *
 * The other change is the emoji. Ozzny closes his lead line with exactly one — 😭 when a
 * player is being candid, 💀 when someone is being humiliated, 🥶 at a number nobody
 * expected — and which one is a judgement about tone that needs the story, so the model
 * picks it. compose.ts supplies a dull default when it declines.
 *
 * The hard constraint is unchanged and is the whole value of the account: nothing may be
 * invented. The quote is passed through verbatim rather than regenerated, so the one part
 * that must be exact cannot drift.
 */
const SYSTEM = [
  "You write posts for a Counter-Strike news account on X. Reply with JSON only.",
  "",
  "EVERY post is: a LEAD sentence, then the body, then one closing fact.",
  "",
  "First decide which kind of post this is.",
  "",
  "QUOTE — the source carries someone's words worth reading. Shape:",
  '{"kind":"quote","lead":"...","emoji":"...","speaker":"...","quote":"...","context":"...","list":[],"people":["..."]}',
  "  lead — ONE sentence, YOUR words, saying who is speaking and what about. It is the",
  "    reason someone reads the quote, so it must promise something.",
  "    GOOD: donk on what makes tN1R so good:",
  "    GOOD: magixx revealed the strategy he used to reset after MOUZ came back on Mirage",
  "    BAD:  \u201CIf I were 10 years younger I would have beaten donk\u201D — TaZ",
  "    The bad one is the quote itself. Never put the quote in the lead: the lead sets it",
  "    up, the next block delivers it. Opening with the payoff wastes it.",
  "  speaker — who said it, nickname only.",
  "  quote — their words, copied EXACTLY, with no quotation marks around it. Two to four",
  "    sentences is ideal; trim to the part that earns the lead, never reword it.",
  "",
  "STORY — something happened and there is no quote worth leading with. Shape:",
  '{"kind":"story","lead":"...","emoji":"...","background":"...","context":"...","list":[],"people":["..."]}',
  "  lead — ONE sentence stating the news, in YOUR words, complete on its own.",
  "    GOOD: ruggah has officially retired from coaching after more than a decade in",
  "          Counter-Strike",
  "    BAD:  JUST IN: ruggah retires",
  "    The bad one is a label plus a headline. Write the sentence a publication writes.",
  "  background — one paragraph of what a reader needs in order to care: the career, the",
  "    history, the run-up. This is what makes it reporting rather than an alert.",
  "    GOOD: The Danish coach worked with Dignitas, North, OpTic, OG and most recently",
  "          Astralis, winning EPICENTER with Dignitas along the way.",
  "",
  "Both shapes also take:",
  "  emoji — DEFAULT TO AN EMPTY STRING. Only return one if the story is unmistakably one",
  "    of the five cases below. A wrong emoji is worse than none: it tells the reader the",
  "    account did not read its own post. If you are choosing between two, return \"\".",
  "    \uD83D\uDE2D  ONLY when someone is being candid about something hard",
  "    \uD83D\uDC80  ONLY when someone is being beaten badly or mocked",
  "    \uD83E\uDD76  ONLY when the post is built around a number nobody expected",
  "    \uD83D\uDC40  ONLY when something previously unknown is being revealed or compared",
  "    \uD83C\uDFC6  ONLY when a trophy has JUST been won by the subject of this post",
  "    A retirement, a transfer, a schedule, a ban, an injury: empty string. None of the",
  "    five fits, and reaching for the nearest one is how a trophy ends up on a retirement.",
  "  context — one short closing fact from the source: what it means now, or the number",
  "    that proves the lead. Empty string if there is none.",
  "  list — ONLY when the source gives two or more PARALLEL items (trophies won, players",
  "    qualified, a head-to-head of numbers). Each entry one short line, no bullet",
  '    character. GOOD: ["NiKo: 9","donk: 10"]. Otherwise an empty array.',
  "  people — every player or personality NAMED, nicknames only, speaker first.",
  "",
  "Rules:",
  "- Retell the FACTS in your own words. Facts are nobody's property; sentences are.",
  "  Never reuse the source's phrasing outside the quote — the post has to read as yours,",
  "  not as a repost of the account you read it on.",
  "- Invent NOTHING. Every name, number, team and claim must appear in the source text.",
  "- Never reword anything inside quote. Those are the speaker's words.",
  "- If unsure of a detail, leave it out rather than guessing.",
  "- NO \u2018JUST IN\u2019, NO \u2018RUMOR:\u2019, no label of any kind in front of the lead.",
  "- No hashtags, no links, no source credit, and no emoji anywhere except the emoji field.",
  "- Plain English, no hype.",
  "- Use Counter-Strike vocabulary: AWPer not sniper, roster not squad list, IGL, LAN, Major.",
  "- NEVER transliterate a name by how it sounds, and never guess a Latin spelling. If you",
  "  do not know one exactly, leave the name as the source wrote it.",
  ...glossaryLines(),
].join("\n");

/**
 * The only emoji this route may return.
 *
 * The prompt asks for one of five and the model still answered 🏆 to a retirement story,
 * live. Instruction alone does not hold here, so the set is enforced: an emoji outside it is
 * dropped, and the post goes out plain — which is what four of five cs2files posts do anyway.
 * This does not stop a WRONG choice from inside the set; the prompt's job is that, and the
 * cost is one character to delete.
 */
const ALLOWED_EMOJI = new Set(["😭", "💀", "🥶", "👀", "🏆"]);

export async function POST(request: Request) {
  if (!hasLlmKey()) {
    return NextResponse.json(
      { error: "No key configured. Add GROQ_API_KEY or GEMINI_API_KEY." },
      { status: 501 },
    );
  }

  let body: { title?: string; summary?: string; paragraphs?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const title = String(body.title ?? "").slice(0, 400);
  if (!title.trim()) return NextResponse.json({ error: "missing title" }, { status: 400 });

  const source = [
    `HEADLINE: ${title}`,
    body.summary ? `STANDFIRST: ${String(body.summary).slice(0, 600)}` : "",
    ...(body.paragraphs ?? []).slice(0, 6).map((p, i) => `PARAGRAPH ${i + 1}: ${String(p).slice(0, 600)}`),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = await ask(SYSTEM, source);
    const parsed = parseJson<{
      kind?: string;
      lead?: string;
      emoji?: string;
      speaker?: string;
      quote?: string;
      background?: string;
      context?: string;
      list?: string[];
      people?: string[];
    }>(raw);

    const kind = parsed?.kind === "story" ? "story" : "quote";
    // The lead is the one field neither shape can do without — it IS the post's first line.
    if (!parsed?.lead?.trim()) {
      return NextResponse.json({ error: "model returned no usable write-up" }, { status: 502 });
    }

    /**
     * One emoji, or none.
     *
     * A model asked for an emoji sometimes returns a word, a sentence, or three of them.
     * Anything carrying a letter or a digit, or running longer than three code points, is
     * dropped rather than shipped into the first line of a post.
     */
    const emoji = (parsed.emoji ?? "").trim();
    // Only the five the prompt documents. Anything else — a word, three emoji, a flag it
    // liked the look of — is dropped rather than shipped into the first line of a post.
    const usableEmoji = ALLOWED_EMOJI.has(emoji) ? emoji : "";

    return NextResponse.json({
      kind,
      lead: correctNames(parsed.lead.trim()),
      emoji: usableEmoji,
      speaker: correctNames((parsed.speaker ?? "").trim()),
      quote: correctNames((parsed.quote ?? "").trim()),
      background: correctNames((parsed.background ?? "").trim()),
      context: correctNames((parsed.context ?? "").trim()),
      // A one-item list is not a list — it would render as a stray "> ". Drop it.
      list: (() => {
        const list = (parsed.list ?? [])
          .map((entry) => correctNames(String(entry).trim().replace(/^[>\-\u2022*]\s*/, "")))
          .filter(Boolean)
          .slice(0, 6);
        return list.length >= 2 ? list : [];
      })(),
      // Nicknames only, deduped — each becomes a photo the post can attach.
      people: [
        ...new Set(
          (parsed.people ?? []).map((p) => correctNames(String(p).trim())).filter(Boolean),
        ),
      ].slice(0, 4),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof LlmError ? error.message : "write-up failed" },
      { status: 502 },
    );
  }
}
