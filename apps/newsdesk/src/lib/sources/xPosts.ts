import type { FeedItem } from "../types";
import { decodeEntities } from "./fetchXml";

/**
 * Reads public X accounts — first-party quotes, attributable to a handle.
 *
 * This exists because the obvious route to interview quotes is closed. YouTube serves a
 * stub to servers so captions cannot be fetched, and its captions endpoint needs to be
 * the video's owner. Transcribing a broadcast automatically is not available for free.
 *
 * But players, orgs and HLTV publish their own words here, and a post carries its author,
 * so every quote arrives with the handle needed to verify it — which is the whole point.
 *
 * HOW IT WORKS, because it is not obvious and it is fragile:
 *   1. The profile page at x.com/<handle> is a JavaScript shell, but the HTML still embeds
 *      the ids of the newest few posts.
 *   2. cdn.syndication.twimg.com — the endpoint X uses to render embedded posts — returns
 *      any public post's full text and media by id, free and unauthenticated. Its token is
 *      derived arithmetically from the id.
 *
 * Neither step needs a key, and the X API has no free tier, so this is the only route. It
 * yields only the newest handful per account, and it will break whenever X changes either
 * page — treat a sudden empty result as that, not as the accounts going quiet.
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface Account {
  handle: string;
  label: string;
  /** Why this account is worth reading, shown on the card. */
  note: string;
}

/**
 * Verified to browse. Handles that resolve to nothing are silently absent rather than an
 * error, so a renamed account disappears quietly — check here first if one stops appearing.
 */
const ACCOUNTS: Account[] = [
  { handle: "HLTVorg", label: "@HLTVorg", note: "their own interview quotes and rankings" },
  { handle: "BLASTPremier", label: "@BLASTPremier", note: "broadcast clips and interviews" },
  { handle: "ESLCS", label: "@ESLCS", note: "event news and interviews" },
  { handle: "TeamVitality", label: "@TeamVitality", note: "first-party team news" },
  { handle: "natusvincere", label: "@natusvincere", note: "first-party team news" },
  { handle: "FaZeClan", label: "@FaZeClan", note: "first-party team news" },
];

/** The token X's own embed player derives from a post id. */
function token(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

interface SyndicationPost {
  __typename?: string;
  text?: string;
  created_at?: string;
  favorite_count?: number;
  user?: { screen_name?: string; name?: string };
  mediaDetails?: { media_url_https?: string; type?: string }[];
}

async function recentIds(handle: string): Promise<string[]> {
  const res = await fetch(`https://x.com/${handle}`, {
    headers: { "User-Agent": UA },
    next: { revalidate: 300 },
  });
  if (!res.ok) return [];
  const html = await res.text();
  return [...new Set([...html.matchAll(/status\/(\d{15,})/g)].map((m) => m[1]))]
    .sort()
    .reverse()
    .slice(0, 6);
}

async function readPost(id: string): Promise<SyndicationPost | null> {
  const res = await fetch(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token(id)}&lang=en`,
    { headers: { "User-Agent": UA }, next: { revalidate: 3600 } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as SyndicationPost;
  // A deleted or protected post comes back as a tombstone rather than an error.
  if (data.__typename === "TweetTombstone" || !data.text) return null;
  return data;
}

/** t.co shorteners are noise in a headline and the real link is in the post anyway. */
function clean(text: string): string {
  return decodeEntities(text.replace(/https:\/\/t\.co\/\w+/g, "")).replace(/\s+/g, " ").trim();
}

async function fetchAccount(account: Account): Promise<FeedItem[]> {
  const ids = await recentIds(account.handle);
  const items: FeedItem[] = [];

  for (const id of ids) {
    const post = await readPost(id);
    if (!post) continue;
    // The profile page lists quoted and replied-to posts too; keep only this account's own.
    if ((post.user?.screen_name ?? "").toLowerCase() !== account.handle.toLowerCase()) continue;

    const text = clean(post.text ?? "");
    if (text.length < 25) continue;

    const [first, ...rest] = text.split(/(?<=[.!?:])\s+/);
    const photo = post.mediaDetails?.find((m) => m.type === "photo")?.media_url_https;

    items.push({
      id: `x:${id}`,
      source: "x",
      // A post carrying quotation marks is someone's words; the rest is announcement.
      kind: /["“]/.test(post.text ?? "") ? "quote" : "news",
      title: first.slice(0, 200),
      summary: rest.join(" ").slice(0, 400),
      url: `https://x.com/${account.handle}/status/${id}`,
      publishedAt: post.created_at ?? new Date().toISOString(),
      // X serves originals at :large; the default is a resized preview.
      image: photo ? `${photo}?format=jpg&name=large` : undefined,
      score: 0,
      reasons: [`${account.label} · ${post.favorite_count ?? 0} likes`],
    });
  }
  return items;
}

export async function fetchXPosts(): Promise<FeedItem[]> {
  // Sequential: this is a scrape of one host, and parallel requests get it blocked.
  const items: FeedItem[] = [];
  for (const account of ACCOUNTS) {
    try {
      items.push(...(await fetchAccount(account)));
    } catch {
      // One account failing must not lose the others.
    }
  }
  if (items.length === 0) throw new Error("no X posts readable — the scrape may have broken");
  return items;
}
