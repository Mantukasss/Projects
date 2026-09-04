import { NextResponse } from "next/server";
import { fetchItemImage } from "@/lib/sources/csItems";

export const runtime = "nodejs";

/**
 * The official Steam image for a Counter-Strike item, by name.
 *
 * Returns the URL rather than the bytes: Steam's economy CDN serves images to browsers
 * without complaint, so there is nothing to proxy, and a redirect keeps this cheap.
 */
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name");
  if (!name) return new NextResponse("missing name", { status: 400 });

  const image = await fetchItemImage(name);
  if (!image) return new NextResponse("no such item", { status: 404 });

  return NextResponse.redirect(image, {
    status: 302,
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}
