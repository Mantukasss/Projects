import { NextResponse } from "next/server";
import { LlmError, ask, hasLlmKey } from "@/lib/llm";

export const runtime = "nodejs";

/**
 * Translates a Russian Telegram post into an English draft line.
 *
 * The edge this app has is that Russian CS media breaks CIS roster news before English
 * outlets do, and most English CS accounts do not read it. That edge only pays if the post
 * comes out in English fast, so this produces the post line directly rather than a literal
 * translation to rewrite by hand.
 *
 * All the provider handling — model discovery, the reasoning-token budget, per-failure
 * reporting — lives in lib/llm.ts, because every one of those was learned here the hard way
 * and the write-up route needed the same lessons.
 */
/**
 * The vocabulary rules are not pedantry. A literal translation of "снайпер" is "sniper",
 * which no Counter-Strike account would ever write — it is "AWPer" — and one word like that
 * tells the audience the post was machine-made. Sounding native is the whole job.
 */
const SYSTEM = [
  "You translate Russian Counter-Strike esports posts into English for a CS2 news account.",
  "Rules:",
  "- Return ONLY the English text. No preamble, no notes, no quotes around it.",
  "- Keep it under 200 characters and keep it factual. Do not add detail that is not there.",
  "- Keep player, team and tournament names in their standard Latin spelling.",
  "- If the original hedges (слух, сообщается, по слухам), keep the hedge in English.",
  "- Drop advertising, emoji spam and channel self-promotion.",
  "Use Counter-Strike vocabulary, not literal translations:",
  "- снайпер -> AWPer (never 'sniper')",
  "- состав / ростер -> roster or lineup",
  "- скамейка / запас -> bench",
  "- игрок замены / стендин -> stand-in",
  "- тренер -> coach; капитан / игрок-лидер -> IGL",
  "- карта -> map; катка / матч -> match; фраг -> frag or kill",
  "- трансфер / переход -> transfer or move",
  "- отбор / квалификация -> qualifier",
  "- лан -> LAN; мажор -> Major",
].join("\n");

export async function POST(request: Request) {
  if (!hasLlmKey()) {
    return NextResponse.json(
      { error: "No translation key configured. Add GROQ_API_KEY or GEMINI_API_KEY." },
      { status: 501 },
    );
  }

  let text: string;
  try {
    text = String(((await request.json()) as { text?: string }).text ?? "").slice(0, 2000);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (!text.trim()) return NextResponse.json({ error: "empty text" }, { status: 400 });

  try {
    return NextResponse.json({ text: await ask(SYSTEM, text) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof LlmError ? error.message : "translation unavailable" },
      { status: 502 },
    );
  }
}
