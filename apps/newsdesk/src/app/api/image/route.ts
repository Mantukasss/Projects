import { NextResponse } from "next/server";
import { USER_AGENT } from "@/lib/sources/fetchXml";

export const runtime = "nodejs";

/**
 * Re-serves a source image from our own origin.
 *
 * The quote card is drawn on a canvas and saved with toDataURL, and a canvas that has had a
 * cross-origin image drawn onto it is "tainted" — the browser refuses to export it and the
 * Save button dies. Proxying makes the image same-origin, so the export works.
 *
 * The allowlist is the point, not decoration: an open image proxy lets anyone use this
 * deployment to fetch arbitrary URLs, including private addresses on the host's network.
 * Only the hosts this app actually reads from are permitted.
 */
const ALLOWED_HOSTS = new Set([
  "liquipedia.net",
  "img-cdn.hltv.org",
  "www.hltv.org",
  "clan.fastly.steamstatic.com",
  "clan.akamai.steamstatic.com",
  "cdn.akamai.steamstatic.com",
  "shared.fastly.steamstatic.com",
  "preview.redd.it",
  "i.redd.it",
  "external-preview.redd.it",
]);

const ONE_DAY = 60 * 60 * 24;

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url");
  if (!target) return new NextResponse("missing url", { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new NextResponse("bad url", { status: 400 });
  }

  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    return new NextResponse("host not allowed", { status: 403 });
  }

  const upstream = await fetch(parsed.toString(), {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: ONE_DAY },
  });
  if (!upstream.ok) return new NextResponse("upstream failed", { status: 502 });

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return new NextResponse("not an image", { status: 415 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${ONE_DAY}, immutable`,
    },
  });
}
