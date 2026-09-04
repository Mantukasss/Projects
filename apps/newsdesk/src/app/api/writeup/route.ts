import { NextResponse } from "next/server";
import { LlmError, ask, hasLlmKey, parseJson } from "@/lib/llm";

export const runtime = "nodejs";

/**
 * Writes the post the way the accounts worth copying write it.
 *
 * Their shape is three parts, and it is not what a headline gives you:
 *
 *   zont1x says Spirit still haven't done enough to call themselves the best team:
 *
 *   "We don't have a 20 map win streak to talk about this. We lost to MOUZ..."
 *
 *   He added that they still need significant results before making that claim.
 *
 * The lead is an editorial summary — it tells you what the quote MEANS before you read it,
 * which is what makes the quote land. A headline cannot supply that; it is the same
 * sentence compressed. So this reads the article's own paragraphs and writes the summary
 * from them, which is what a person doing this job actually does.
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
  '{"lead": "...", "quote": "...", "context": "..."}',
  "",
  "lead — one line, third person, naming who said it and what it MEANS. Ends with a colon.",
  "  It must PARAPHRASE, never echo the quote's wording, and it should name the team or",
  "  subject the quote is about even when the speaker only implies it.",
  '  GOOD: zont1x says Spirit still haven\'t done enough to call themselves the best team in the world:',
  '  BAD:  zont1x says we don\'t yet have significant results to say that we are the best:',
  "  The bad one just repeats the quote in different punctuation, so the reader learns",
  "  nothing before reading it and the post reads as though it was assembled by a script.",
  "quote — the speaker's words, COPIED EXACTLY from the source. Never reword or shorten them.",
  "  If the source carries no direct quote, return an empty string.",
  "context — one short sentence of supporting fact from the source. Empty string if there is none.",
  "",
  "Rules:",
  "- Invent NOTHING. Every name, number, team and claim must appear in the source text.",
  "- If you are unsure of a detail, leave it out rather than guessing.",
  "- Plain English, no hype, no emoji, no hashtags, no links.",
  "- Use Counter-Strike vocabulary: AWPer not sniper, roster not squad list, IGL, LAN, Major.",
  "- Keep lead under 140 characters and context under 140.",
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
    const parsed = parseJson<{ lead?: string; quote?: string; context?: string }>(raw);
    if (!parsed?.lead) {
      return NextResponse.json({ error: "model returned no usable write-up" }, { status: 502 });
    }
    return NextResponse.json({
      lead: parsed.lead.trim(),
      quote: (parsed.quote ?? "").trim(),
      context: (parsed.context ?? "").trim(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof LlmError ? error.message : "write-up failed" },
      { status: 502 },
    );
  }
}
