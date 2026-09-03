import { NextResponse } from "next/server";
import { USER_AGENT, decodeEntities } from "@/lib/sources/fetchXml";

export const runtime = "nodejs";

/**
 * Pulls the teams and the body text out of an HLTV article.
 *
 * Exists because of a real failure in the feed: "PGL Masters Bucharest 2026 Closed
 * Qualifier teams announced" is not a post. It promises a list and delivers nothing, and
 * an account that posts headlines with the substance missing teaches people to scroll past
 * it. The RSS feed carries only a headline and a one-line standfirst, so the list has to
 * come from the article itself.
 *
 * Team names are read from HLTV's own links (`/team/<id>/<slug>`) rather than parsed out of
 * prose. That is the difference between a list that is right and a list that is plausible.
 */
const ALLOWED_HOST = "www.hltv.org";

/**
 * HLTV writes the team's own casing into the link text — MOUZ, 9z, The MongolZ. Rebuilding
 * it from the URL slug produced "Mouz", "9Z" and "THE Mongolz", which is exactly the kind
 * of small wrongness that makes a post look automated.
 */
function teamNamesFrom(body: string): string[] {
  const names = new Map<string, string>();
  for (const match of body.matchAll(
    /<a[^>]+href="\/team\/\d+\/([^"?]+)"[^>]*>([\s\S]*?)<\/a>/g,
  )) {
    const slug = match[1];
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (text && !names.has(slug)) names.set(slug, text);
  }
  return [...names.values()];
}

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url");
  if (!target) return NextResponse.json({ error: "missing url" }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== ALLOWED_HOST) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }

  const res = await fetch(parsed.toString(), {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 300 },
  });
  if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });

  const html = await res.text();
  const start = html.indexOf("newstext-con");
  const body = start >= 0 ? html.slice(start, start + 60_000) : "";

  const paragraphs = [...body.matchAll(/<p class="news-block">([\s\S]*?)<\/p>/g)]
    .map((match) => decodeEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Order of appearance, de-duplicated — that ordering is meaningful in these articles.
  const teams = teamNamesFrom(body);

  return NextResponse.json(
    { teams, paragraphs: paragraphs.slice(0, 8) },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
