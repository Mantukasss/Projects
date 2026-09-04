import { NextResponse } from "next/server";
import { LlmError, ask, hasLlmKey, parseJson } from "@/lib/llm";

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
  "Shape:",
  '{"hook": "...", "speaker": "...", "quote": "...", "context": "...", "people": ["..."]}',
  "",
  "hook — the single most arresting line the speaker actually said, quoted word for word,",
  "  short enough to read at a glance. This is the line that makes someone stop scrolling,",
  "  so pick the boldest claim, not the opening sentence. Omit the surrounding quote marks.",
  '  GOOD: If I were 10 years younger, I would have beaten donk and s1mple',
  '  BAD:  It is impossible to compare because I look at how they play',
  "  The bad one is throat-clearing; nobody stops for it.",
  "speaker — who said it, as the scene writes their name.",
  "quote — the fuller passage giving the hook its reasoning, copied EXACTLY from the source.",
  "  It may run to a few sentences. Empty string if the source carries no direct quote.",
  "context — one short sentence of supporting fact from the source. Empty string if none.",
  "people — every player or personality NAMED in the text, speaker first, as nicknames only.",
  '  For the example above: ["TaZ", "donk", "s1mple"]',
  "",
  "Rules:",
  "- Invent NOTHING. Every name, number, team and claim must appear in the source text.",
  "- Never reword anything inside hook or quote. They are the speaker's words, not yours.",
  "- If you are unsure of a detail, leave it out rather than guessing.",
  "- Plain English, no hype, no emoji, no hashtags, no links.",
  "- Use Counter-Strike vocabulary: AWPer not sniper, roster not squad list, IGL, LAN, Major.",
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
      hook?: string;
      speaker?: string;
      quote?: string;
      context?: string;
      people?: string[];
    }>(raw);
    if (!parsed?.hook) {
      return NextResponse.json({ error: "model returned no usable write-up" }, { status: 502 });
    }
    return NextResponse.json({
      hook: parsed.hook.trim(),
      speaker: (parsed.speaker ?? "").trim(),
      quote: (parsed.quote ?? "").trim(),
      context: (parsed.context ?? "").trim(),
      // Nicknames only, deduped — each becomes a photo the post can attach.
      people: [...new Set((parsed.people ?? []).map((p) => String(p).trim()).filter(Boolean))].slice(0, 4),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof LlmError ? error.message : "write-up failed" },
      { status: 502 },
    );
  }
}
