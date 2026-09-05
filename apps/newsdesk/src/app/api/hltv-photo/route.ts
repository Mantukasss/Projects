import { NextResponse } from "next/server";
import { fetchHltvPhoto, indexedNicknames } from "@/lib/sources/hltvPhotos";

export const runtime = "nodejs";

/**
 * The URL of a player's HLTV bodyshot — the URL, not the bytes.
 *
 * HLTV's image CDN answers a browser and refuses a server, so this cannot proxy the image
 * the way /api/photo does for Liquipedia. The address is handed to the page and the
 * viewer's browser fetches it directly, which works.
 *
 * The consequence is that these photos are cross-origin and therefore cannot be drawn onto
 * the canvas that builds the matched square. They are offered as their own tile instead.
 *
 * Without ?name it reports what the index currently holds, which is the quickest way to see
 * whether a player is missing because they are absent from the news or because the harvest
 * broke.
 */
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name");

  if (!name) {
    const nicknames = await indexedNicknames();
    return NextResponse.json({ count: nicknames.length, nicknames: nicknames.slice(0, 100) });
  }

  const url = await fetchHltvPhoto(name);
  if (!url) return NextResponse.json({ error: "not in the index" }, { status: 404 });
  return NextResponse.json({ url });
}
