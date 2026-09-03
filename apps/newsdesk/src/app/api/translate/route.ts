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

/** Overridable, because a model name is the thing most likely to be retired under us. */
const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
/** Rolling alias on purpose: pinned Gemini names lose free-tier quota and 429 on every call. */
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

const SYSTEM = [
  "You translate Russian Counter-Strike esports posts into English for a news account.",
  "Rules:",
  "- Return ONLY the English text. No preamble, no notes, no quotes around it.",
  "- Keep it under 200 characters and keep it factual. Do not add detail that is not there.",
  "- Keep player, team and tournament names in their standard Latin spelling.",
  "- If the original hedges (слух, сообщается, по слухам), keep the hedge in English.",
  "- Drop advertising, emoji spam and channel self-promotion.",
].join("\n");

async function viaGroq(text: string, key: string): Promise<string | null> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      max_tokens: 200,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() ?? null;
}

async function viaGemini(text: string, key: string): Promise<string | null> {
  const res = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
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
  let translated: string | null = null;
  if (groqKey) translated = await viaGroq(text, groqKey).catch(() => null);
  if (!translated && geminiKey) translated = await viaGemini(text, geminiKey).catch(() => null);

  if (!translated) {
    return NextResponse.json({ error: "translation unavailable" }, { status: 502 });
  }
  return NextResponse.json({ text: translated });
}
