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
 * THE SWEEP IS CONCURRENT, and the note that used to be here saying it could not be was
 * simply wrong — asserted, never tested. Measured: 29 accounts and 87 posts in 2.7 seconds at
 * concurrency 10, with zero failed requests; sequentially the same work read SEVEN accounts
 * inside its budget, so a given org was seen about every four minutes. That gap was the
 * difference between having an announcement and not. Concurrency is held at a modest 6 —
 * enough to read every account on every refresh with room to spare, low enough not to look
 * like an attack from an IP this app does not control.
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
  /**
   * True when the account's posts are taken whole rather than tested for CS relevance.
   *
   * EVERY first-party account is true, including orgs that field LoL and Valorant teams, and
   * that is not an oversight. FUT announced Krabeni's renewal as "The Mastermind stays. We
   * are thrilled to announce that we have renewed Krabeni's contract." — no game named, no
   * team named, no word in the CS vocabulary. The relevance test would have thrown away the
   * exact post this whole exercise is about. An org's own announcement is the one thing that
   * must never be filtered out; OTHER_GAME and PROMO remove the noise instead.
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
  /**
   * True for an account that IS the news rather than reporting it.
   *
   * These are read on EVERY refresh, ahead of the media accounts, with a shorter cache.
   * The reason is a post that got beaten: @Ozzny_CS2 published Krabeni's FUT extension at
   * 13:46:18, HLTV's article went up at 13:49:00 and their tweet at 13:49:37 — so anything
   * reading HLTV was nearly three minutes late before it started. Contract and roster news
   * breaks on the ORG'S OWN ACCOUNT, because the org controls the announcement. Reading the
   * outlets that report it is reading second.
   */
  firstParty?: boolean;
}

/**
 * Enough to tell a Counter-Strike post from a general gaming one. Team and player names
 * carry most of the weight, because a real CS post names somebody.
 */
/**
 * Another game, named. Almost every org in the list runs more than one team.
 *
 * This is the filter the CS_RELEVANT test cannot do on its own. A dedicated CS account's
 * posts are taken whole — filtering those would drop roster news that happens not to say
 * "CS" — but an org account posts about all its divisions, and "Lots of MOBA action this
 * weekend" and "A SUPER #FURIALOL VENCE!" both arrived in the feed from orgs marked as
 * CS-only. Naming another game is near-perfect evidence the post is not ours, and unlike a
 * positive CS test it cannot throw away an announcement for being tersely worded.
 */
const OTHER_GAME =
  /\b(lol|league of legends|valorant|val|dota\s?2?|rocket league|rl|apex|fortnite|r6|rainbow six|siege|pubg|overwatch|ow2|mobile legends|free fire|wild rift|tft|teamfight|starcraft|honor of kings|efootball|fifa|ea fc|f1|nba2k|brawl stars|clash royale|moba)\b|#\w*(lol|val|rl|dota|ff|ml)\b/i;

/**
 * Unmistakably Counter-Strike, used ONLY to overrule OTHER_GAME.
 *
 * Deliberately narrower than CS_RELEVANT, which is full of words every esport uses —
 * "roster", "LAN", "Major", "IGL" — and of team names belonging to orgs that also field LoL
 * and Valorant sides. Judged by those, "Rocket League roster update incoming" reads as
 * Counter-Strike. What cannot be mistaken is the game's own name, its maps, its weapons and
 * its players.
 */
const DEFINITELY_CS =
  /\b(cs2|csgo|cs|counter-?strike|hltv|awp(er)?|ak-?47|m4a1|deagle|vertigo|mirage|inferno|nuke|ancient|dust2|anubis|overpass|train|s1mple|donk|zywoo|m0nesy|niko|ropz|ap[eE]X|torzsi|xertion|frozen|broky|karrigan|magixx|sh1ro|zont1x|molodoy|jame|fallen|device|blast premier|iem katowice|iem cologne)\b/i;

/**
 * Merchandise, sponsors and giveaways — the price of reading org accounts whole.
 *
 * Taking every first-party post is the right call (see Account.csOnly), and this is what it
 * costs: "BUY THE COOLEST OF THEM ALL, BUY THE FUT SPRAY", a gaming-chair ad, a spray sale.
 * None of it is news and all of it would take a slot in a feed capped at sixty.
 *
 * Kept deliberately narrow and anchored to COMMERCIAL language rather than to topics. "Sign"
 * and "deal" are not here on purpose — "we have signed", "a new deal" are exactly how a
 * transfer is announced, and dropping those to remove an ad would be trading the thing for
 * the noise around it.
 *
 * KNOWN MISS, accepted: a product post carrying no commercial verb — "Meet the Secretlab
 * TITAN Evo, designed to provide ergonomic support" — reads as an ordinary post and gets
 * through. Catching it needs either a list of sponsor brands, which never ends, or words
 * broad enough to swallow announcements. One ad in the feed is the cheaper mistake.
 */
const PROMO =
  /\b(buy|shop|sale|discount|promo code|use code|sponsor(ed|ship)?|presented by|giveaway|merch|drop(s|ping) (now|soon))\b|#ad\b/i;

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
  { handle: "s1mpleO", label: "@s1mpleO", note: "first-party", csOnly: true, player: "s1mple", firstParty: true },
  { handle: "ZywOo", label: "@ZywOo", note: "first-party", csOnly: true, player: "ZywOo", firstParty: true },
  { handle: "torzsi_", label: "@torzsi_", note: "first-party", csOnly: true, player: "torzsi", firstParty: true },

  // Orgs announcing their own business.
  /**
   * EVERY HANDLE HERE WAS VERIFIED, not guessed. Each was fetched and its newest post read
   * back to confirm the account exists, is the right one, and is still posting. The ones
   * that did not resolve are listed in CLAUDE.md so nobody guesses them again.
   */
  { handle: "TeamVitality", label: "@TeamVitality", note: "first-party team news", csOnly: true, team: "Team Vitality", firstParty: true },
  { handle: "natusvincere", label: "@natusvincere", note: "first-party team news", csOnly: true, team: "Natus Vincere", firstParty: true },
  { handle: "FaZeClan", label: "@FaZeClan", note: "first-party team news", csOnly: true, team: "FaZe Clan", firstParty: true },
  { handle: "G2esports", label: "@G2esports", note: "first-party team news", csOnly: true, team: "G2 Esports", firstParty: true },
  { handle: "FURIA", label: "@FURIA", note: "first-party team news", csOnly: true, team: "FURIA Esports", firstParty: true },
  { handle: "paiNGamingBR", label: "@paiNGamingBR", note: "first-party team news", csOnly: true, team: "paiN Gaming", firstParty: true },
  { handle: "FalconsEsport", label: "@FalconsEsport", note: "first-party team news", csOnly: true, team: "Team Falcons", firstParty: true },
  { handle: "mousesports", label: "@mousesports", note: "first-party team news", csOnly: true, team: "MOUZ", firstParty: true },
  { handle: "TeamLiquidCS", label: "@TeamLiquidCS", note: "first-party team news", csOnly: true, team: "Team Liquid", firstParty: true },
  { handle: "astralisgg", label: "@astralisgg", note: "first-party team news", csOnly: true, team: "Astralis", firstParty: true },
  { handle: "heroicgg", label: "@heroicgg", note: "first-party team news", csOnly: true, team: "Heroic", firstParty: true },
  { handle: "Cloud9", label: "@Cloud9", note: "first-party team news", csOnly: true, team: "Cloud9", firstParty: true },
  { handle: "complexity", label: "@complexity", note: "first-party team news", csOnly: true, team: "Complexity Gaming", firstParty: true },
  { handle: "BIGCLANgg", label: "@BIGCLANgg", note: "first-party team news", csOnly: true, team: "BIG", firstParty: true },
  { handle: "imperialesports", label: "@imperialesports", note: "first-party team news", csOnly: true, team: "Imperial Esports", firstParty: true },
  { handle: "9zTeam", label: "@9zTeam", note: "first-party team news", csOnly: true, team: "9z Team", firstParty: true },
  { handle: "BetBoomTeam", label: "@BetBoomTeam", note: "first-party team news", csOnly: true, team: "BetBoom Team", firstParty: true },
  { handle: "virtuspro", label: "@virtuspro", note: "first-party team news", csOnly: true, team: "Virtus.pro", firstParty: true },
  { handle: "GamerLegion", label: "@GamerLegion", note: "first-party team news", csOnly: true, team: "GamerLegion", firstParty: true },
  { handle: "FNATIC", label: "@FNATIC", note: "first-party team news", csOnly: true, team: "Fnatic", firstParty: true },
  { handle: "FlyQuest", label: "@FlyQuest", note: "first-party team news", csOnly: true, team: "FlyQuest", firstParty: true },
  { handle: "NRGgg", label: "@NRGgg", note: "first-party team news", csOnly: true, team: "NRG Esports", firstParty: true },
  { handle: "M80gg", label: "@M80gg", note: "first-party team news", csOnly: true, team: "M80", firstParty: true },
  { handle: "WildcardGaming", label: "@WildcardGaming", note: "first-party team news", csOnly: true, team: "Wildcard Gaming", firstParty: true },
  { handle: "NIPCS", label: "@NIPCS", note: "first-party team news", csOnly: true, team: "Ninjas in Pyjamas", firstParty: true },
  { handle: "tyloogaming", label: "@tyloogaming", note: "first-party team news", csOnly: true, team: "TYLOO", firstParty: true },
  /**
   * These six came from LIQUIPEDIA'S INFOBOX, not from guessing — which is how the first
   * round missed them. Every team page carries the org's official social links, so the
   * handle is a lookup, not a puzzle. Use `action=parse&section=0` and read `twitter =`.
   *
   * @futesportsgg is the one that started this: it announced Krabeni's renewal at 13:35:24
   * and Ozzny posted at 13:46:18. The story was sitting in public for eleven minutes.
   */
  { handle: "Team__Spirit", label: "@Team__Spirit", note: "first-party team news", csOnly: true, team: "Team Spirit", firstParty: true },
  { handle: "1mongolz", label: "@1mongolz", note: "first-party team news", csOnly: true, team: "The MongolZ", firstParty: true },
  { handle: "AuroraCS2_GG", label: "@AuroraCS2_GG", note: "first-party team news", csOnly: true, team: "Aurora Gaming", firstParty: true },
  { handle: "sawggofficial", label: "@sawggofficial", note: "first-party team news", csOnly: true, team: "SAW", firstParty: true },
  { handle: "futesportsgg", label: "@futesportsgg", note: "first-party team news", csOnly: true, team: "FUT Esports", firstParty: true },
];

/**
 * How long one refresh may spend here, split so the accounts that BREAK news are never the
 * ones the budget runs out on.
 *
 * The first-party pass goes first and gets most of the time. Media accounts report what the
 * orgs already said, so being a refresh late on those costs nothing; being a refresh late on
 * an org's own announcement is the whole margin. Most of both passes is served from the
 * shared Data Cache anyway — the budget only bites when the cache is cold.
 */
const FIRST_PARTY_BUDGET_MS = 7000;
const MEDIA_BUDGET_MS = 4000;

/**
 * How many accounts to read at once.
 *
 * Six covers all the first-party accounts in under five seconds measured, against ten's
 * under three. The headroom is deliberate: this runs from Vercel's shared egress IPs rather
 * than the one it was measured on, and a scrape that gets an address blocked costs far more
 * than a second saved.
 */
const CONCURRENCY = 6;

/**
 * How long a profile's list of post ids may be reused.
 *
 * This was 300 seconds for everything, which put FIVE MINUTES of staleness on top of the
 * feed's own 60 — so an org announcement could sit unread for longer than the margin being
 * chased. First-party accounts now match the feed's own cadence; media accounts keep the
 * long cache, because nothing breaks there first.
 */
const IDS_TTL_FIRST_PARTY = 60;
const IDS_TTL_MEDIA = 300;

/**
 * How many posts deep to read per account.
 *
 * An announcement is always the newest post, so three is enough for an org and spends a
 * third of the requests. Media accounts get the full six because a thread of separate
 * stories is normal there.
 */
const DEPTH_FIRST_PARTY = 3;
const DEPTH_MEDIA = 6;

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

async function recentIds(handle: string, ttl: number, depth: number): Promise<string[]> {
  const res = await fetch(`https://x.com/${handle}`, {
    headers: { "User-Agent": UA },
    next: { revalidate: ttl },
  });
  if (!res.ok) return [];
  const html = await res.text();
  return [...new Set([...html.matchAll(/status\/(\d{15,})/g)].map((m) => m[1]))]
    .sort()
    .reverse()
    .slice(0, depth);
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
  const ids = await recentIds(
    account.handle,
    account.firstParty ? IDS_TTL_FIRST_PARTY : IDS_TTL_MEDIA,
    account.firstParty ? DEPTH_FIRST_PARTY : DEPTH_MEDIA,
  );
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
    /**
     * Any account, even a CS-only one, loses a post that names another game — unless it
     * ALSO names something unmistakably Counter-Strike, which is how a "our CS and VAL teams
     * both qualified" post survives.
     */
    if (OTHER_GAME.test(text) && !DEFINITELY_CS.test(text)) continue;
    // Merch and sponsor posts, which reading org accounts whole necessarily lets in.
    if (PROMO.test(text)) continue;

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
  const items: FeedItem[] = [];

  /**
   * One pass over a group, CONCURRENCY accounts at a time, starting at a rotating offset.
   *
   * The offset used to matter a great deal — it decided which accounts a sequential sweep
   * could afford before its budget ran out. Now that a whole group fits comfortably inside
   * the budget it is only insurance for the day a group grows past what the budget covers.
   */
  const sweep = async (group: Account[], budgetMs: number) => {
    if (group.length === 0) return;
    const deadline = Date.now() + budgetMs;
    const offset = Math.floor(Date.now() / 60_000) % group.length;
    const queue = [...group.slice(offset), ...group.slice(0, offset)];

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let account = queue.shift(); account; account = queue.shift()) {
          if (Date.now() > deadline) return;
          try {
            items.push(...(await fetchAccount(account, deadline)));
          } catch {
            // One account failing must not lose the others.
          }
        }
      }),
    );
  };

  // First party first, always. See FIRST_PARTY_BUDGET_MS.
  await sweep(ACCOUNTS.filter((a) => a.firstParty), FIRST_PARTY_BUDGET_MS);
  await sweep(ACCOUNTS.filter((a) => !a.firstParty), MEDIA_BUDGET_MS);

  if (items.length === 0) throw new Error("no X posts readable — the scrape may have broken");
  return items;
}
