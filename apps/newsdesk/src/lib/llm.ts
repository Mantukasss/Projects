/**
 * One place that talks to a language model, so every feature gets the same hard-won
 * handling rather than each rediscovering it.
 *
 * Three things here were learned the expensive way and must not be undone:
 *
 *  - The model is DISCOVERED, never hardcoded. A plausible-looking model name that Groq had
 *    retired failed every call for two deploys.
 *  - The token budget is generous. Groq's current models reason before answering and the
 *    budget covers the reasoning, so a tight cap gets spent thinking and returns an empty
 *    message — which looks exactly like a broken key.
 *  - Every failure path records WHY. A flat "unavailable" made a wrong model name
 *    indistinguishable from a dead key or a rate limit.
 *
 * Groq first because this work is short and latency-sensitive, which is what it is for;
 * Gemini as the fallback. With no key configured, callers get null and the feature is
 * absent rather than broken.
 */
const GROQ_CHAT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS = "https://api.groq.com/openai/v1/models";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

/** Rolling alias on purpose: pinned Gemini names lose free-tier quota and then 429. */
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

/** Smallest capable first — this is short work, and the small models are the fast ones. */
const PREFERRED = [/gpt-oss-20b/i, /gpt-oss-120b/i, /qwen/i, /kimi/i, /llama/i];
const UNSUITABLE = /whisper|tts|guard|safeguard|embed|vision|compound/i;

const MODEL_TTL_MS = 60 * 60 * 1000;
let cachedModel: { id: string; at: number } | null = null;

export class LlmError extends Error {}

async function resolveGroqModel(key: string): Promise<string> {
  const override = process.env.GROQ_MODEL;
  if (override) return override;
  if (cachedModel && Date.now() - cachedModel.at < MODEL_TTL_MS) return cachedModel.id;

  const res = await fetch(GROQ_MODELS, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new LlmError(`Groq models ${res.status}`);

  const ids: string[] = ((await res.json())?.data ?? [])
    .map((model: { id?: string }) => model.id)
    .filter((id: string | undefined): id is string => typeof id === "string" && !UNSUITABLE.test(id));
  if (ids.length === 0) throw new LlmError("Groq offered no usable model");

  const picked = PREFERRED.map((p) => ids.find((id) => p.test(id))).find(Boolean) ?? ids[0];
  cachedModel = { id: picked, at: Date.now() };
  return picked;
}

async function viaGroq(system: string, user: string, key: string): Promise<string> {
  const model = await resolveGroqModel(key);
  const res = await fetch(GROQ_CHAT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 1200,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new LlmError(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const choice = (await res.json())?.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    throw new LlmError(`Groq returned no text (finish=${choice?.finish_reason}, model=${model})`);
  }
  return content;
}

async function viaGemini(system: string, user: string, key: string): Promise<string> {
  const res = await fetch(`${GEMINI}/${GEMINI_MODEL}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1200 },
    }),
  });
  if (!res.ok) throw new LlmError(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const candidate = (await res.json())?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new LlmError(`Gemini returned no text (finish=${candidate?.finishReason})`);
  return text;
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
}

/** Runs the prompt, trying Groq then Gemini. Throws LlmError naming the real failure. */
export async function ask(system: string, user: string): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!groqKey && !geminiKey) throw new LlmError("No key configured");

  const failures: string[] = [];
  if (groqKey) {
    try {
      return await viaGroq(system, user, groqKey);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (geminiKey) {
    try {
      return await viaGemini(system, user, geminiKey);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new LlmError(failures.join(" | ") || "no provider succeeded");
}

/** Models wrap JSON in prose or fences however firmly you ask them not to. */
export function parseJson<T>(raw: string): T | null {
  const fenced = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
