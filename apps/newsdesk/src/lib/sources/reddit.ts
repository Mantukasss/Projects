import type { FeedItem } from "../types";
import { asArray, decodeEntities, fetchXml, stripTags } from "./fetchXml";

const FEED = "https://www.reddit.com/r/GlobalOffensive/new/.rss";

interface AtomEntry {
  title?: string;
  content?: string | { "#text"?: string };
  link?: { "@_href"?: string } | { "@_href"?: string }[];
  id?: string;
  published?: string;
  updated?: string;
  "media:thumbnail"?: { "@_url"?: string };
}

/**
 * The picture is the post.
 *
 * A Reddit item like "Glock-18 | Floating Camo" is a skin concept — the image IS the news,
 * and posting the headline beside a generic game capsule is worse than not posting it.
 * Reddit exposes the image twice over: a media:thumbnail element, and full-size links
 * inside the HTML content. Preview URLs beat the thumbnail, which is tiny.
 */
/**
 * Trades Reddit's signed thumbnail for the original.
 *
 * A preview.redd.it link is a resized crop with its dimensions baked into a signature —
 * the ones in this feed are 140x78, which is unusable as a post image, and the signature
 * means the width cannot simply be raised. The same image id on i.redd.it is the untouched
 * upload: verified, the preview 403s while i.redd.it returns the original at 1920x1080.
 *
 * external-preview.redd.it is left alone. It is a thumbnail of a linked third-party page
 * rather than an upload, so there is no original of ours to point at.
 */
function fullSize(url: string): string {
  const preview = url.match(/^https:\/\/preview\.redd\.it\/([^?]+)/i);
  return preview ? `https://i.redd.it/${preview[1]}` : url;
}

function imageFrom(entry: AtomEntry, contentHtml: string): string | undefined {
  /**
   * The query string is part of the URL, not decoration. A preview.redd.it link carries a
   * signature in `s=`, and an earlier pattern here stopped at the first `&` — so every
   * Reddit image came back truncated and 403'd.
   */
  const direct = contentHtml.match(
    /https:\/\/(?:i\.redd\.it|preview\.redd\.it|i\.imgur\.com)\/[^\s"'<>]+/i,
  )?.[0];
  if (direct) return fullSize(decodeEntities(direct));

  const embedded = contentHtml.match(/<img[^>]+src="([^"]+)"/i)?.[1];
  if (embedded) return fullSize(decodeEntities(embedded));

  return entry["media:thumbnail"]?.["@_url"];
}

/**
 * Reddit is the early-warning channel, not a citable source: clips and drama surface
 * here before the sites write them up. score.ts weights it below HLTV for that reason.
 *
 * Reddit rate-limits its public .rss endpoints per IP, so whether it answers depends on
 * which IP asks. It refuses this repo's build sandbox and answers Vercel's runtime fine —
 * an earlier note here claimed all datacenter ranges were blocked, which was wrong and was
 * really the sandbox's own egress policy. On by default; if a deployment does start getting
 * 429s, staleOnError keeps serving the last good copy and the fix is a free Reddit OAuth
 * app (script type, 100 requests/minute).
 *
 * Reddit escapes each post's full HTML into its Atom <content>, which pushes past the XML
 * parser's default entity-expansion cap — see the processEntities config in fetchXml.ts.
 */
export async function fetchReddit(): Promise<FeedItem[]> {
  const parsed = (await fetchXml(FEED, 120)) as { feed?: { entry?: AtomEntry | AtomEntry[] } };

  return asArray(parsed.feed?.entry).flatMap((entry): FeedItem[] => {
    const title = decodeEntities(String(entry.title ?? "")).trim();
    const url = asArray(entry.link)[0]?.["@_href"]?.trim();
    if (!title || !url) return [];

    const rawContent = String(
      (typeof entry.content === "object" ? entry.content?.["#text"] : entry.content) ?? "",
    );

    return [
      {
        id: `reddit:${entry.id ?? url}`,
        source: "reddit",
        kind: "news",
        title,
        summary: stripTags(rawContent).slice(0, 240),
        url,
        image: imageFrom(entry, rawContent),
        publishedAt: new Date(entry.published ?? entry.updated ?? Date.now()).toISOString(),
        score: 0,
        reasons: [],
      },
    ];
  });
}
