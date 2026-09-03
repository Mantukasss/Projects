"use client";

import { useCallback, useEffect, useState } from "react";
import { IconRefresh, IconSettings } from "@tabler/icons-react";
import type { FeedItem, SourceId } from "@/lib/types";
import { SOURCE_NAME } from "@/lib/compose";
import ItemCard from "./ItemCard";
import QuoteCard from "./QuoteCard";

const ALL_SOURCES: SourceId[] = ["hltv", "liquipedia", "steam", "telegram", "reddit", "vlr"];
const DEFAULT_SOURCES: SourceId[] = ["hltv", "liquipedia", "steam", "telegram", "reddit"];

const POSTED_KEY = "newsdesk.posted";
const HANDLE_KEY = "newsdesk.handle";
const SOURCES_KEY = "newsdesk.sources";

/** localStorage is per-device and can throw in private mode — never let it break the feed. */
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode, quota, or blocked site data — the feed still works without it */
  }
}

export default function Feed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [errors, setErrors] = useState<{ source: string; message: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [posted, setPosted] = useState<string[]>([]);
  const [handle, setHandle] = useState("@your_handle");
  const [sources, setSources] = useState<SourceId[]>(DEFAULT_SOURCES);
  const [showSettings, setShowSettings] = useState(false);
  const [cardFor, setCardFor] = useState<FeedItem | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPosted(readStored<string[]>(POSTED_KEY, []));
    setHandle(readStored<string>(HANDLE_KEY, "@your_handle"));
    setSources(readStored<SourceId[]>(SOURCES_KEY, DEFAULT_SOURCES));
    setHydrated(true);
  }, []);

  const load = useCallback(
    async (active: SourceId[]) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/feed?sources=${active.join(",")}`, { cache: "no-store" });
        const data = await res.json();
        setItems(data.items ?? []);
        setErrors(data.errors ?? []);
        setFetchedAt(data.fetchedAt ?? null);
      } catch (error) {
        setErrors([{ source: "feed", message: String(error) }]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!hydrated) return;
    load(sources);
    // Sources are cached for 60s server-side, so polling faster than that buys nothing.
    const timer = setInterval(() => load(sources), 90_000);
    return () => clearInterval(timer);
  }, [hydrated, load, sources]);

  const togglePosted = (id: string) => {
    setPosted((current) => {
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      // Keep the list bounded so it can't grow forever in storage.
      const trimmed = next.slice(-500);
      writeStored(POSTED_KEY, trimmed);
      return trimmed;
    });
  };

  const toggleSource = (source: SourceId) => {
    setSources((current) => {
      const next = current.includes(source)
        ? current.filter((x) => x !== source)
        : [...current, source];
      writeStored(SOURCES_KEY, next);
      return next;
    });
  };

  return (
    <main
      className="mx-auto min-h-[100dvh] w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8"
      style={{
        paddingTop: "max(1.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <header className="mb-6 flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text">Newsdesk</h1>
          <p className="text-sm text-text-muted">
            {loading
              ? "Refreshing…"
              : fetchedAt
                ? `${items.length} items · updated ${new Date(fetchedAt).toLocaleTimeString()}`
                : "—"}
          </p>
        </div>
        <button
          onClick={() => load(sources)}
          aria-label="Refresh"
          className="ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border text-text-muted transition-colors duration-150 ease-out hover:text-text"
        >
          <IconRefresh size={20} stroke={1.5} className={loading ? "animate-spin" : ""} />
        </button>
        <button
          onClick={() => setShowSettings((value) => !value)}
          aria-label="Settings"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border text-text-muted transition-colors duration-150 ease-out hover:text-text"
        >
          <IconSettings size={20} stroke={1.5} />
        </button>
      </header>

      {showSettings && (
        <section className="mb-6 rounded-2xl border border-border bg-surface p-4">
          <label className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
            Your handle
          </label>
          <input
            value={handle}
            onChange={(event) => {
              setHandle(event.target.value);
              writeStored(HANDLE_KEY, event.target.value);
            }}
            className="mb-4 min-h-11 w-full rounded-md border border-border bg-bg px-3 text-text outline-none focus:border-border-focus"
          />
          <p className="mb-2 text-xs uppercase tracking-wide text-text-muted">Sources</p>
          <div className="flex flex-wrap gap-2">
            {ALL_SOURCES.map((source) => (
              <button
                key={source}
                onClick={() => toggleSource(source)}
                className={`min-h-11 rounded-md border px-3 text-sm transition-colors duration-150 ease-out ${
                  sources.includes(source)
                    ? "border-amber text-amber"
                    : "border-border text-text-low"
                }`}
              >
                {SOURCE_NAME[source]}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-text-low">
            VLR.gg is off by default: one game per account beats a mixed feed, because X
            ranks an account by the audience cluster that engages with it and two games
            split that cluster in half.
          </p>
        </section>
      )}

      {errors.length > 0 && (
        <div className="mb-4 rounded-2xl border border-coral/40 bg-surface p-3 text-sm text-text-muted">
          {errors.map((error) => (
            <p key={error.source}>
              <span className="text-coral">{error.source}</span> unavailable — {error.message}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            handle={handle}
            posted={posted.includes(item.id)}
            onTogglePosted={() => togglePosted(item.id)}
            onMakeCard={() => setCardFor(item)}
          />
        ))}
        {!loading && items.length === 0 && (
          <p className="py-12 text-center text-text-muted">
            Nothing in the feed. Check your sources in settings.
          </p>
        )}
      </div>

      {cardFor && (
        <QuoteCard item={cardFor} handle={handle} onClose={() => setCardFor(null)} />
      )}
    </main>
  );
}
