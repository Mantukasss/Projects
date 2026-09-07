/**
 * Transcripts for YouTube interviews — the spoken quotes, in text.
 *
 * This is the source that makes an interview usable. HLTV Confirmed runs to well over a
 * hundred thousand characters an episode: hours of players answering questions on the
 * record that nobody has written down.
 *
 * Every direct route is closed, and each was tested rather than assumed. The watch page
 * returns a stub to servers; `youtubei/v1/player` answers LOGIN_REQUIRED — "Sign in to
 * confirm you're not a bot" — for every client context; Piped instances 403 or 500; and
 * Invidious instances list the caption tracks but serve zero bytes for them, because
 * YouTube blocks their fetches too. All of that is IP reputation on datacenter ranges.
 *
 * kome.ai's transcript endpoint answers, and answers correctly: asked for four different
 * HLTV videos it returned four different transcripts, each matching its video. That is a
 * third party, so it can disappear or start charging — hence the deliberate failure path
 * below, and a note in the app's docs on what to try next if it does.
 */
const ENDPOINT = "https://kome.ai/api/transcript";
const TTL_MS = 24 * 60 * 60 * 1000;

/** A transcript is large and never changes, so it is worth holding on to. */
const cache = new Map<string, { text: string | null; at: number }>();

/** YouTube ids appear in several link shapes; take whichever is present. */
export function videoIdFrom(url: string): string | null {
  return (
    url.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] ??
    url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1] ??
    url.match(/\/shorts\/([A-Za-z0-9_-]{11})/)?.[1] ??
    null
  );
}

export async function fetchTranscript(videoId: string): Promise<string | null> {
  const cached = cache.get(videoId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.text;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: videoId, format: true }),
      next: { revalidate: 86_400 },
    });
    if (!res.ok) throw new Error(`transcript ${res.status}`);

    const data = (await res.json()) as { transcript?: string };
    const text = (data.transcript ?? "").trim();
    // A handful of characters means captions exist but carry nothing usable.
    const usable = text.length > 400 ? text : null;
    cache.set(videoId, { text: usable, at: Date.now() });
    return usable;
  } catch {
    // Cached briefly rather than for a day: an outage should not blank this until tomorrow.
    cache.set(videoId, { text: null, at: Date.now() - TTL_MS + 5 * 60_000 });
    return null;
  }
}
