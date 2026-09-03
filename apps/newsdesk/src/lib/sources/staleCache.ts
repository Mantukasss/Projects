/**
 * Serves the last good result when a source refuses a request.
 *
 * Liquipedia caps action=query at one request per 30 seconds per IP and answers 429 past
 * that. Next's Data Cache is shared across instances on Vercel, so the 60s revalidate
 * normally stays inside the cap — but a cold instance, a manual refresh and a scheduled
 * revalidate can still collide, and a 429 must not look to the user like the source died.
 *
 * Deliberately in-process and unbounded-in-time: it holds one entry per source, it is a
 * few kilobytes, and a stale roster lead is worth far more than an empty feed.
 */
interface Entry<T> {
  value: T;
  at: number;
}

const store = new Map<string, Entry<unknown>>();

export async function staleOnError<T>(
  key: string,
  load: () => Promise<T>,
): Promise<{ value: T; stale: boolean; error?: string }> {
  try {
    const value = await load();
    store.set(key, { value, at: Date.now() });
    return { value, stale: false };
  } catch (error) {
    const cached = store.get(key) as Entry<T> | undefined;
    if (!cached) throw error;
    return {
      value: cached.value,
      stale: true,
      error: `${String((error as Error).message ?? error)} — showing data from ${new Date(
        cached.at,
      ).toLocaleTimeString()}`,
    };
  }
}
