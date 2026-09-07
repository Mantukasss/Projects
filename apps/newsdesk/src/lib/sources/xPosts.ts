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
 * Neither step needs a key, and the X API has no free tier, so this is the only route.
 *
 * DEPTH IS CAPPED AT ABOUT FIVE POSTS PER ACCOUNT and cannot be raised: the ids in the page
 * are the handful X embeds for search engines. Every widening was tried — mobile user
 * agent, /with_replies, /media, twitter.com, and the embed timeline widget, which returns an
 * empty shell because it loads its entries from a gated client call. So the answer is
 * breadth: many accounts, five each, rather than one account and fifty.
 *
 * Because that means a lot of requests, the sweep runs against a TIME BUDGET and starts at a
 * rotating offset. One refresh covers as many accounts as it can afford; the next starts
 * where pressure is different, and Vercel's shared Data Cache means most of what it revisits
 * is already there. Over a few minutes every account gets read without any single request
 * paying for all of them.
 *
 * It will break whenever X changes either page — treat a sudden empty result as that, not
 * as the accounts going quiet.
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface Account {
  handle: string;
  label: string;
  /** Why this account is worth reading, shown on the card. */
  note: string;
  /**
   * True when everything the account posts is Counter-Strike.
   *
   * Some of the best-informed accounts cover all of gaming — Dexerto's feed arrived
   * carrying a Rockstar story and a mountain rescue — so their posts are filtered for
   * relevance while a dedicated CS account's are taken whole. Filtering everything would
   * throw away roster news that happens not to say the word "CS".
   */
  csOnly: boolean;
  /**
   * The Liquipedia page for the org that owns this account, where it is an org account.
   *
   * The post is ABOUT whoever posted it, and nothing in the text says so. A FURIA post
   * reading "Já temos data marcada para voltar ao servidor!" named its next opponent and
   * nothing else, so reading the team out of the text put the GamerLegion crest on FURIA's
   * own announcement. The author is the one fact about a first-party post that is certain.
   */
  team?: string;
  /** The player who owns this account, where it is a player account — same reasoning. */
  player?: string;
}

/**
 * Enough to tell a Counter-Strike post from a general gaming one. Team and player names
 * carry most of the weight, because a real CS post names somebody.
 */
const CS_RELEVANT =
  /\b(cs2|csgo|counter-?strike|hltv|blast|iem|esl|pgl|major|awp(er)?|igl|lan|vertigo|mirage|inferno|nuke|ancient|dust2|anubis|train|overpass|roster|stand-?in|vitality|navi|natus vincere|spirit|falcons|mouz|g2|furia|faze|astralis|liquid|heroic|mongolz|aurora|fnatic|nip|ninjas in pyjamas|virtus|betboom|3dmax|gamerlegion|eternal fire|pain gaming|imperial|legacy|tyloo|complexity|nrg|m80|wildcard|s1mple|donk|zywoo|m0nesy|niko|ropz|apex|torzsi|xertion|frozen|broky|karrigan|magixx|sh1ro|zont1x|molodoy|jame|jl|fallen)\b/i;

/**
 * Verified to browse. Handles that resolve to nothing are silently absent rather than an
 * error, so a renamed account disappears quietly — check here first if one stops appearing.
 */
const ACCOUNTS: Account[] = [
  // Media and broadcast: where interviews get published.
  { handle: "HLTVorg", label: "@HLTVorg", note: "interview quotes and rankings", csOnly: true },
  { handle: "BLASTPremier", label: "@BLASTPremier", note: "broadcast clips and interviews", csOnly: true },
  { handle: "ESLCS", label: "@ESLCS", note: "event news and interviews", csOnly: true },
  { handle: "richardlewis", label: "@richardlewis", note: "reporting and long-form takes", csOnly: false },
  { handle: "jaxon_gg", label: "@jaxon_gg", note: "CS coverage", csOnly: false },
  { handle: "dexerto", label: "@dexerto", note: "esports coverage", csOnly: false },
  { handle: "strife_gg", label: "@strife_gg", note: "CS coverage", csOnly: false },

  // Players speaking for themselves — the most attributable quote there is.
  { handle: "s1mpleO", label: "@s1mpleO", note: "first-party", csOnly: true, player: "s1mple" },
  { handle: "ZywOo", label: "@ZywOo", note: "first-party", csOnly: true, player: "ZywOo" },
  { handle: "torzsi_", label: "@torzsi_", note: "first-party", csOnly: true, player: "torzsi" },

  // Orgs announcing their own business.
  { handle: "TeamVitality", label: "@TeamVitality", note: "first-party team news", csOnly: true, team: "Team Vitality" },
  { handle: "natusvincere", label: "@natusvincere", note: "first-party team news", csOnly: true, team: "Natus Vincere" },
  { handle: "FaZeClan", label: "@FaZeClan", note: "first-party team news", csOnly: true, team: "FaZe Clan" },
  { handle: "G2esports", label: "@G2esports", note: "first-party team news", csOnly: true, team: "G2 Esports" },
  { handle: "FURIA", label: "@FURIA", note: "first-party team news", csOnly: true, team: "FURIA Esports" },
  { handle: "paiNGamingBR", label: "@paiNGamingBR", note: "first-party team news", csOnly: true, team: "paiN Gaming" },
];

/**
 * How long one refresh may spend here. Beyond this it returns what it has: a feed that
 * arrives with twelve accounts read beats one that times out having read all seventeen.
 */
const TIME_BUDGET_MS = 6000;

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

async function fetchAccount(account: Account, deadline = Infinity): Promise<FeedItem[]> {
  const ids = await recentIds(account.handle);
  const items: FeedItem[] = [];

  for (const id of ids) {
    if (Date.now() > deadline) break;
    const post = await readPost(id);
    if (!post) continue;
    // The profile page lists quoted and replied-to posts too; keep only this account's own.
    if ((post.user?.screen_name ?? "").toLowerCase() !== account.handle.toLowerCase()) continue;

    const text = clean(post.text ?? "");
    if (text.length < 25) continue;
    // A general-gaming account has to prove the post is about Counter-Strike.
    if (!account.csOnly && !CS_RELEVANT.test(text)) continue;

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
      // Who posted it beats what the text names. See Account.team.
      ...(account.team ? { teamPage: account.team } : {}),
      ...(account.player ? { playerName: account.player } : {}),
    });
  }
  return items;
}

export async function fetchXPosts(): Promise<FeedItem[]> {
  const deadline = Date.now() + TIME_BUDGET_MS;

  // Start somewhere different each minute so no account is permanently last in the queue
  // and therefore permanently unread.
  const offset = Math.floor(Date.now() / 60_000) % ACCOUNTS.length;
  const order = [...ACCOUNTS.slice(offset), ...ACCOUNTS.slice(0, offset)];

  // Sequential: this is a scrape of one host, and parallel requests get it blocked.
  const items: FeedItem[] = [];
  for (const account of order) {
    if (Date.now() > deadline) break;
    try {
      items.push(...(await fetchAccount(account, deadline)));
    } catch {
      // One account failing must not lose the others.
    }
  }
  if (items.length === 0) throw new Error("no X posts readable — the scrape may have broken");
  return items;
}
