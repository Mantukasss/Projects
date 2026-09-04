import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Translates a Russian Telegram post into an English draft line.
 *
 * The edge this app has is that Russian CS media breaks CIS roster news before English
 * outlets do, and most English CS accounts do not read it. That edge only pays if the post
 * comes out in English fast, so this turns the translation into the post line directly
 * rather than handing back a literal translation to rewrite by hand.
 *
 * Groq first because this is short, high-volume and latency-sensitive, which is what it is
 * good at; Gemini as the fallback. With neither key set the route answers 501 and the card
 * simply keeps showing the Russian — the feature is absent, never broken.
 */
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Groq's model is DISCOVERED, not hardcoded.
 *
 * A hardcoded name is the thing most likely to break here, and it did: a plausible-looking
 * guess was not in Groq's current lineup, so every call failed with an error that said only
 * "translation unavailable" — the feature looked broken when the wiring was fine. Groq
 * publishes what it actually serves, so the route asks.
 *
 * Preference order is smallest-capable-first. Translating one short post is not hard work,
 * and the small models are the fast ones, which is the entire reason to use Groq.
 * GROQ_MODEL overrides all of it when a specific model is wanted.
 */
const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

const PREFERRED = [/gpt-oss-20b/i, /gpt-oss-120b/i, /qwen/i, /kimi/i, /llama/i];

/** Models that cannot do chat completion, or should not be asked to. */
const UNSUITABLE = /whisper|tts|guard|safeguard|embed|vision|compound/i;

let cachedModel: { id: string; at: number } | null = null;
const MODEL_TTL_MS = 60 * 60 * 1000;

async function resolveGroqModel(key: string): Promise<string | null> {
  const override = process.env.GROQ_MODEL;
  if (override) return override;
  if (cachedModel && Date.now() - cachedModel.at < MODEL_TTL_MS) return cachedModel.id;

  const res = await fetch(GROQ_MODELS_URL, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;

  const ids: string[] = ((await res.json())?.data ?? [])
    .map((model: { id?: string }) => model.id)
    .filter((id: string | undefined): id is string => Boolean(id) && !UNSUITABLE.test(id!));
  if (ids.length === 0) return null;

  const picked = PREFERRED.map((pattern) => ids.find((id) => pattern.test(id))).find(Boolean) ?? ids[0];
  cachedModel = { id: picked, at: Date.now() };
  return picked;
}
/** Rolling alias on purpose: pinned Gemini names lose free-tier quota and 429 on every call. */
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

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

/**
 * Why the last attempt failed, surfaced to the caller.
 *
 * The first version returned a flat "translation unavailable" for every failure, which made
 * a wrong model name indistinguishable from a dead key or a rate limit — and turned a
 * one-line fix into a hunt. Providers say what is wrong; there is no reason to discard it.
 */
let lastFailure = "";

async function viaGroq(text: string, key: string): Promise<string | null> {
  const model = await resolveGroqModel(key);
  if (!model) {
    lastFailure = "Groq: could not resolve a usable model";
    return null;
  }

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      /**
       * Generous on purpose. Groq's current models are reasoning models, and the budget
       * covers the reasoning as well as the reply — so a tight cap gets spent thinking and
       * returns an empty message with finish_reason "length". That is exactly what happened
       * here: short inputs translated fine and a 370-character one came back blank, which
       * looked like a broken key rather than a budget.
       */
      max_tokens: 1200,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) {
    lastFailure = `Groq ${res.status}: ${(await res.text()).slice(0, 300)}`;
    return null;
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    // The last silent path. A 200 with no usable content used to return null without
    // recording anything, so the handler reported the generic message and the real cause
    // stayed invisible across several deploys.
    lastFailure = `Groq returned no text (finish_reason=${choice?.finish_reason ?? "unknown"}, model=${model})`;
    return null;
  }
  return content;
}

async function viaGemini(text: string, key: string): Promise<string | null> {
  const res = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text }] }],
      // Same reasoning-budget trap as Groq: the cap covers thinking, not just the reply.
      generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
    }),
  });
  if (!res.ok) {
    lastFailure = `Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`;
    return null;
  }
  const data = await res.json();
  const text_ = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text_) {
    lastFailure = `Gemini returned no text (finish=${data?.candidates?.[0]?.finishReason ?? "unknown"})`;
    return null;
  }
  return text_;
}

export async function POST(request: Request) {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!groqKey && !geminiKey) {
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

  // Each provider is tried once. A failure here must never look like a broken feed, so the
  // card falls back to showing the original.
  // The catch has to record too. Recording only inside the providers left a thrown error —
  // a DNS failure, a socket reset, a bad JSON body — reported as the same flat
  // "translation unavailable" as a wrong model, which is exactly the blindness the
  // per-provider reporting was added to remove.
  lastFailure = "";
  let translated: string | null = null;

  if (groqKey) {
    translated = await viaGroq(text, groqKey).catch((error: unknown) => {
      lastFailure = `Groq threw: ${error instanceof Error ? error.message : String(error)}`;
      return null;
    });
  }
  if (!translated && geminiKey) {
    translated = await viaGemini(text, geminiKey).catch((error: unknown) => {
      lastFailure = `Gemini threw: ${error instanceof Error ? error.message : String(error)}`;
      return null;
    });
  }

  if (!translated) {
    return NextResponse.json(
      { error: lastFailure || "translation unavailable" },
      { status: 502 },
    );
  }
  return NextResponse.json({ text: translated });
}
