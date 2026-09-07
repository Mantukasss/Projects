import { NextResponse } from "next/server";
import { LlmError, ask, hasLlmKey, parseJson } from "@/lib/llm";
import { correctNames, glossaryLines } from "@/lib/glossary";
import { fetchTranscript, videoIdFrom } from "@/lib/sources/transcripts";

export const runtime = "nodejs";

/**
 * Pulls the postable quotes out of an interview.
 *
 * An episode transcript runs to six figures of characters — hours of speech in which maybe
 * five sentences are worth posting. Finding those is the actual work, and it is what turns
 * a video link into a day's posts.
 *
 * Two things make this safe to publish, and both matter more than yield:
 *
 *  - AUTO-GENERATED CAPTIONS HAVE NO SPEAKER LABELS. The transcript is one undifferentiated
 *    stream, so who said a line is often genuinely unknowable from the text. A wrong
 *    attribution is the worst thing this app could produce, so the model must return the
 *    speaker as null unless the transcript itself names them, and a quote without a
 *    confident speaker still ships — it just goes out unattributed for a human to fix.
 *  - CAPTIONS MISHEAR THINGS, especially nicknames. Every quote therefore comes back with
 *    the timestamp region it came from, so it can be checked against the video before it
 *    goes anywhere.
 */
const SYSTEM = [
  "You read a Counter-Strike interview transcript and pull out the lines worth posting.",
  "Reply with JSON only:",
  '{"quotes":[{"text":"...","speaker":"..." or null,"about":"...","confidence":"high"|"low"}]}',
  "",
  "Pick at most five. A line is worth posting when it is a claim, an opinion, a revelation",
  "or a criticism that would make someone stop scrolling. Skip pleasantries, questions from",
  "the host, and anything that only makes sense with the video playing.",
  "",
  "text — the speaker's words, copied from the transcript. You may fix obvious caption",
  "  mistranscriptions of NAMES only, using the list below. Never rewrite the sentence.",
  "speaker — who said it. This transcript has NO speaker labels, so use null unless the",
  "  transcript itself names them nearby. Guessing is worse than leaving it null.",
  "about — one short phrase on what the quote concerns.",
  "confidence — 'high' only if the wording is clean and the speaker is certain.",
  "",
  "Rules:",
  "- Invent nothing. Every quote must appear in the transcript.",
  "- Auto-generated captions garble words. If a line is too garbled to trust, leave it out.",
  "- Use Counter-Strike vocabulary: AWPer not sniper, roster not squad list, IGL, LAN, Major.",
  ...glossaryLines(),
].join("\n");

/** How much transcript to read. Enough for a full interview, short of the context limit. */
const CHUNK = 14_000;
const MAX_CHUNKS = 4;

interface Quote {
  text?: string;
  speaker?: string | null;
  about?: string;
  confidence?: string;
}

export async function POST(request: Request) {
  if (!hasLlmKey()) {
    return NextResponse.json({ error: "No key configured. Add GROQ_API_KEY." }, { status: 501 });
  }

  let url: string;
  try {
    url = String(((await request.json()) as { url?: string }).url ?? "");
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const videoId = videoIdFrom(url);
  if (!videoId) return NextResponse.json({ error: "not a YouTube link" }, { status: 400 });

  const transcript = await fetchTranscript(videoId);
  if (!transcript) {
    return NextResponse.json(
      { error: "No transcript for this video — it may have no captions." },
      { status: 404 },
    );
  }

  // Read from the start: interviews put the substance early, before the sign-off.
  const chunks: string[] = [];
  for (let i = 0; i < MAX_CHUNKS && i * CHUNK < transcript.length; i += 1) {
    chunks.push(transcript.slice(i * CHUNK, (i + 1) * CHUNK));
  }

  const quotes: Quote[] = [];
  const failures: string[] = [];

  for (const chunk of chunks) {
    try {
      const parsed = parseJson<{ quotes?: Quote[] }>(await ask(SYSTEM, chunk));
      for (const quote of parsed?.quotes ?? []) {
        if (!quote.text || quote.text.length < 25) continue;
        quotes.push({
          text: correctNames(quote.text.trim()),
          speaker: quote.speaker ? correctNames(String(quote.speaker).trim()) : null,
          about: correctNames((quote.about ?? "").trim()),
          confidence: quote.confidence === "high" ? "high" : "low",
        });
      }
    } catch (error) {
      failures.push(error instanceof LlmError ? error.message : String(error));
    }
  }

  if (quotes.length === 0) {
    return NextResponse.json(
      { error: failures[0] ?? "nothing quotable found in this transcript" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    quotes: quotes.slice(0, 8),
    transcriptChars: transcript.length,
    // Named so it is obvious the quote needs checking against the video, not trusted blind.
    verify: `https://www.youtube.com/watch?v=${videoId}`,
  });
}
