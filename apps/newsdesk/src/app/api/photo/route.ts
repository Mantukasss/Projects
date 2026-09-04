import { NextResponse } from "next/server";
import { USER_AGENT } from "@/lib/sources/fetchXml";
import { fetchTeamLogo, type Wiki } from "@/lib/sources/liquipediaLogo";

export const runtime = "nodejs";

/**
 * Streams a player's photo from their Liquipedia page.
 *
 * A post about a person should show the person. This reuses the infobox extraction the
 * badge route uses — the first image on a player's page is their portrait, the same way it
 * is a team's crest on a team page — so there is one mechanism, not two.
 *
 * A miss is entirely normal: the nickname is guessed from the headline, plenty of players
 * have no photo on the wiki, and the page may not exist at all. The route answers 404 and
 * the post falls back to the crest, so a wrong guess costs nothing.
 */
const ONE_DAY = 60 * 60 * 24;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const name = params.get("name");
  if (!name) return new NextResponse("missing name", { status: 400 });
  const wiki: Wiki = params.get("wiki") === "valorant" ? "valorant" : "counterstrike";

  const photoUrl = await fetchTeamLogo(name, wiki);
  if (!photoUrl) return new NextResponse("no photo found", { status: 404 });

  const upstream = await fetch(photoUrl, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: ONE_DAY },
  });
  if (!upstream.ok) return new NextResponse("upstream failed", { status: 502 });

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) return new NextResponse("not an image", { status: 415 });

  return new NextResponse(upstream.body, {
    headers: { "Content-Type": contentType, "Cache-Control": `public, max-age=${ONE_DAY}` },
  });
}
