import { NextResponse } from "next/server";
import { USER_AGENT } from "@/lib/sources/fetchXml";
import { fetchTeamLogo, looksLikeTeam } from "@/lib/sources/liquipediaLogo";

export const runtime = "nodejs";

/**
 * Streams a team's Liquipedia badge, resolved from its page title.
 *
 * On demand rather than with the feed: each badge costs one Liquipedia parse request that
 * cannot be batched, so resolving every team on every refresh trips their rate limiter.
 * Opening one card costs one request, which is well inside it.
 *
 * Streaming the bytes rather than returning the URL also keeps the image same-origin, so
 * the quote-card canvas stays exportable.
 */
const ONE_DAY = 60 * 60 * 24;

export async function GET(request: Request) {
  const title = new URL(request.url).searchParams.get("title");
  if (!title) return new NextResponse("missing title", { status: 400 });

  // Player pages resolve to their current team's badge, which on a transfer story is the
  // club they may be leaving. Teams only.
  if (!looksLikeTeam(title)) return new NextResponse("not a team page", { status: 404 });

  const logoUrl = await fetchTeamLogo(title);
  if (!logoUrl) return new NextResponse("no logo found", { status: 404 });

  const upstream = await fetch(logoUrl, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: ONE_DAY },
  });
  if (!upstream.ok) return new NextResponse("upstream failed", { status: 502 });

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) return new NextResponse("not an image", { status: 415 });

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${ONE_DAY}`,
    },
  });
}
