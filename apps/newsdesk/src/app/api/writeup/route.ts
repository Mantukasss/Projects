import { NextResponse } from "next/server";
import { LlmError, ask, hasLlmKey, parseJson } from "@/lib/llm";
import { correctNames, glossaryLines } from "@/lib/glossary";

export const runtime = "nodejs";

/**
 * Writes the post the way the accounts worth copying write it.
 *
 * The shape that works in this scene leads with the sharpest thing the person actually
 * said, attributes it, and only then gives the reasoning:
 *
 *   "If I were 10 years younger, I would have beaten donk and s1mple" — TaZ
 *
 *   "It's impossible to compare, because I look at how they play and well, if I were
 *   10 or 15 years younger, I would easily beat them..."
 *
 *   TaZ won three straight Majors with Virtus.pro.
 *
 * The hook is the speaker's own words, not a summary of them. A summary asks the reader to
 * take the account's word for why this matters; a bold claim in quotation marks makes the
 * case by itself, and it is the reason someone stops scrolling. Picking WHICH line is the
 * editorial judgement, and it needs the whole article — which is why HLTV pieces are
 * fetched before this runs.
 *
 * It also returns everyone named, because a quote about donk and s1mple wants photographs
 * of donk and s1mple, not a team crest.
 *
 * The hard constraint is that nothing may be invented. A news account's entire value is
 * that its posts are true, and a model asked to write engagingly will reach for detail it
 * does not have. The prompt forbids it and the quote is passed through verbatim rather
 * than regenerated, so the one part that must be exact cannot drift.
 */
const SYSTEM = [
  "You write posts for a Counter-Strike news account on X. Reply with JSON only.",
  "",
  "First decide which kind of post this is.",
  "",
  'QUOTE — the source carries someone\'s words worth leading with. Shape:',
  '{"kind":"quote","hook":"...","speaker":"...","quote":"...","context":"...","people":["..."]}',
  "  hook — the single most arresting line the speaker actually said, word for word, short",
  "    enough to read at a glance. Pick the boldest claim, never the opening sentence.",
  '    GOOD: If I were 10 years younger, I would have beaten donk and s1mple',
  '    BAD:  It is impossible to compare because I look at how they play',
  "  speaker — who said it. quote — the fuller passage, copied EXACTLY. May be empty.",
  "",
  "STORY — something happened and there is no quote worth leading with. Shape:",
  '{"kind":"story","opening":"...","reason":"...","consequence":"...","context":"...","people":["..."]}',
  "  opening — what happened, in YOUR OWN WORDS, carrying the turn that makes it a story.",
  '    GOOD: FlyQuest were set to play the IEM Beijing Qualifier final... but had to forfeit',
  '    BAD:  FlyQuest forfeit their match',
  "    The bad one states an outcome; the good one sets up an expectation and breaks it,",
  "    which is what makes someone read the next line.",
  "  reason — the single detail that explains it. One line.",
  '    GOOD: internet issues on their end meant playing on 200+ ping',
  "  consequence — what it means now, or who it affects. May be empty.",
  "",
  "Both shapes also take:",
  "  context — one short supporting fact from the source. Empty string if there is none.",
  "  people — every player or personality NAMED, as nicknames only, speaker first.",
  "",
  "Rules:",
  "- Retell the FACTS in your own words. Facts are nobody's property; sentences are.",
  "  Never reuse the source's phrasing outside a direct quote — the post has to read as",
  "  yours, not as a repost of the account you read it on.",
  "- Invent NOTHING. Every name, number, team and claim must appear in the source text.",
  "- Never reword anything inside hook or quote. Those are the speaker's words.",
  "- If unsure of a detail, leave it out rather than guessing.",
  "- Plain English, no hype, no emoji, no hashtags, no links.",
  "- Use Counter-Strike vocabulary: AWPer not sniper, roster not squad list, IGL, LAN, Major.",
  "- NEVER transliterate a name by how it sounds, and never guess a Latin spelling. If you",
  "  do not know one exactly, leave the name as the source wrote it.",
  ...glossaryLines(),
].join("\n");

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
      hook?: string;
      speaker?: string;
      quote?: string;
      opening?: string;
      reason?: string;
      consequence?: string;
      context?: string;
      people?: string[];
    }>(raw);

    const kind = parsed?.kind === "story" ? "story" : "quote";
    // Each shape has one field it cannot do without.
    const usable = kind === "story" ? parsed?.opening : parsed?.hook;
    if (!usable) {
      return NextResponse.json({ error: "model returned no usable write-up" }, { status: 502 });
    }

    return NextResponse.json({
      kind,
      hook: correctNames((parsed?.hook ?? "").trim()),
      speaker: correctNames((parsed?.speaker ?? "").trim()),
      quote: correctNames((parsed?.quote ?? "").trim()),
      opening: correctNames((parsed?.opening ?? "").trim()),
      reason: correctNames((parsed?.reason ?? "").trim()),
      consequence: correctNames((parsed?.consequence ?? "").trim()),
      context: correctNames((parsed?.context ?? "").trim()),
      // Nicknames only, deduped — each becomes a photo the post can attach.
      people: [
        ...new Set(
          (parsed?.people ?? []).map((p) => correctNames(String(p).trim())).filter(Boolean),
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
