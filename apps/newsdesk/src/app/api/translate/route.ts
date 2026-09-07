import { NextResponse } from "next/server";
import { LlmError, ask, hasLlmKey } from "@/lib/llm";
import { correctNames, glossaryLines } from "@/lib/glossary";
import { needsTranslation } from "@/lib/language";

export const runtime = "nodejs";

/**
 * Translates a post in any language into an English draft line.
 *
 * The edge this app has is that non-English CS media breaks news before the English outlets
 * do, and most English CS accounts do not read it: Russian sources for CIS roster moves,
 * Portuguese for the Brazilian scene, French for Vitality, Turkish for Eternal Fire. That
 * edge only pays if the post comes out in English fast, so this produces the post line
 * directly rather than a literal translation to rewrite by hand.
 *
 * It is not told which language it is reading. Naming it would mean guessing between
 * Portuguese and Spanish on posts that share most of their vocabulary, and a model handed a
 * wrong language label follows the label instead of the text.
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
  "You translate Counter-Strike esports posts into English for a CS2 news account.",
  "The source may be in any language — Russian, Portuguese, Spanish, French, German,",
  "Danish, Swedish, Turkish, Polish, Ukrainian, Chinese. Work it out from the text.",
  "Rules:",
  "- If the text is ALREADY English, return it unchanged rather than rewriting it.",
  "- Return ONLY the English text. No preamble, no notes, no quotes around it.",
  "- Keep it under 200 characters and keep it factual. Do not add detail that is not there.",
  "- NEVER transliterate a name by how it sounds. Counter-Strike nicknames are stylised",
  "  and cannot be derived from their Cyrillic spelling: Монеси is m0NESY, not 'Montesko';",
  "  Ринкл is r1nkle, not 'Rinkl'; Соколов is the genitive of the TEAM Falcons, not a",
  "  person called Sokolov. If a name is not in the list below and you do not know its",
  "  exact Latin spelling, leave it exactly as written. A left-alone name can be fixed in",
  "  seconds; an invented one goes out looking like the account does not follow the game.",
  "- If the original hedges (слух, сообщается, rumor, segundo, selon, angeblich), keep the",
  "  hedge in English. A hedge dropped in translation turns a rumour into a report.",
  "- Drop advertising, emoji spam and channel self-promotion.",
  "Use Counter-Strike vocabulary, not literal translations. The Russian column is spelled",
  "out because Cyrillic sources are the most common; the same rule applies whatever the",
  "language — a word no Counter-Strike account would write is wrong even if it is accurate:",
  "- снайпер -> AWPer (never 'sniper')",
  "- состав / ростер -> roster or lineup",
  "- скамейка / запас -> bench",
  "- игрок замены / стендин -> stand-in",
  "- тренер -> coach; капитан / игрок-лидер -> IGL",
  "- карта -> map; катка / матч -> match; фраг -> frag or kill",
  "- трансфер / переход -> transfer or move",
  "- отбор / квалификация -> qualifier",
  "- лан -> LAN; мажор -> Major",
  "- Portuguese/Spanish: line/lineup stays 'roster'; 'servidor' in a team post means the",
  "  server, i.e. they are back to playing; 'confronto'/'enfrentamento' -> match or matchup",
  "- French: 'effectif' -> roster; 'joueur remplaçant' -> stand-in; 'entraîneur' -> coach",
  ...glossaryLines(),
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

  /**
   * English in, English out — without asking the model.
   *
   * The prompt says to return English text unchanged and the model ignores it: handed
   * "JUST IN: donk drops 30 kills as Team Spirit take Nuke off FaZe" it returned "donk
   * scores 30 kills as Team Spirit win Nuke over FaZe", losing the label and rewording a
   * line that was already right. An instruction a model reliably disobeys is not a rule, so
   * this is enforced here. It also saves the call.
   */
  if (!needsTranslation(text)) return NextResponse.json({ text });

  try {
    // The prompt is instruction; correctNames is enforcement. A model that has just
    // written a fluent sentence will still drop an invented name into it.
    return NextResponse.json({ text: correctNames(await ask(SYSTEM, text)) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof LlmError ? error.message : "translation unavailable" },
      { status: 502 },
    );
  }
}
