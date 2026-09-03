import { NextResponse } from "next/server";
import type { FeedItem } from "@/lib/types";
import { dedupe, scoreItem } from "@/lib/score";
import { fetchHltv } from "@/lib/sources/hltv";
import { fetchLiquipedia } from "@/lib/sources/liquipedia";
import { fetchReddit } from "@/lib/sources/reddit";
import { fetchSteam } from "@/lib/sources/steam";
import { fetchTelegram } from "@/lib/sources/telegram";
import { alreadyCovered, fetchRivalPosts } from "@/lib/sources/rivals";
import { markIncomplete } from "@/lib/incomplete";
import { fetchVlr } from "@/lib/sources/vlr";
import { staleOnError } from "@/lib/sources/staleCache";

export const runtime = "nodejs";
export const revalidate = 60;

const SOURCES = {
  hltv: fetchHltv,
  liquipedia: fetchLiquipedia,
  reddit: fetchReddit,
  steam: fetchSteam,
  telegram: fetchTelegram,
  vlr: fetchVlr,
} as const;

type SourceKey = keyof typeof SOURCES;

/** VLR is the only source off by default — one game per account beats two (see vlr.ts). */
const DEFAULT_SOURCES: SourceKey[] = ["hltv", "liquipedia", "steam", "telegram", "reddit"];

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("sources");
  const keys = requested
    ? (requested.split(",").filter((key): key is SourceKey => key in SOURCES) as SourceKey[])
    : DEFAULT_SOURCES;

  // One slow or blocked source must never take the whole feed down with it.
  const settled = await Promise.allSettled(
    keys.map((key) => staleOnError(key, () => SOURCES[key]())),
  );

  const items: FeedItem[] = [];
  const errors: { source: string; message: string }[] = [];

  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      errors.push({
        source: keys[index],
        message: String(result.reason?.message ?? result.reason),
      });
      return;
    }
    items.push(...result.value.value);
    if (result.value.stale) {
      errors.push({ source: keys[index], message: result.value.error ?? "showing cached data" });
    }
  });

  // What the incumbents have already posted. Never a source of items — only the answer to
  // "am I late?". A failure here must not cost us the feed, so it degrades to "unknown".
  const rivals = await fetchRivalPosts().catch(() => []);

  const annotated = items.map((item) => {
    const flagged = markIncomplete(item);
    const scooped = alreadyCovered(flagged.title, flagged.summary, rivals);
    return scooped ? { ...flagged, scooped } : flagged;
  });

  const ranked = dedupe(annotated.map(scoreItem)).sort((a, b) => b.score - a.score);

  return NextResponse.json(
    { items: ranked.slice(0, 60), errors, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
