import type { FeedItem } from "../types";
import { fetchJson } from "./fetchXml";

/**
 * The edge signal — the one thing here that a competing account cannot get by reading the
 * same news sites faster.
 *
 * Liquipedia editors update player and team pages within minutes of a roster move becoming
 * known, often before an English-language site writes it up. We read the wiki's
 * recent-changes stream and keep the edits that landed on a player or team page.
 *
 * The filter is inverted from the obvious design, and the obvious design does not work:
 * most Liquipedia edit summaries are EMPTY, so requiring a roster keyword in the comment
 * throws away nearly every real lead. Verified against a live sample of 200 changes —
 * keyword-on-comment matched 0, page-shape matched 20, and the 20 were the right ones.
 * So the page's identity is the signal and the comment is only a ranking bonus.
 *
 * The strongest form is a BURST: several player pages plus a team page edited inside the
 * same short window is a roster shuffle being documented in real time. Single edits are
 * weak leads; a cluster is a story.
 *
 * These are LEADS, never confirmed stories. An edit can be wrong, reverted, or vandalism,
 * so compose.ts writes them hedged and the card is marked unverified.
 *
 * Liquipedia caps action=query at one request per 30 seconds per IP. This is the only
 * Liquipedia call the feed makes, cached for 90s to leave headroom, and the caller wraps
 * it in staleOnError so a 429 serves the previous result instead of an empty section.
 */
const API =
  "https://liquipedia.net/counterstrike/api.php" +
  "?action=query&list=recentchanges" +
  "&rcprop=title%7Ctimestamp%7Ccomment%7Cids" +
  "&rcnamespace=0&rclimit=200&rctype=edit%7Cnew&rcshow=!bot&format=json";

interface Change {
  title?: string;
  timestamp?: string;
  comment?: string;
  rcid?: number;
}

/**
 * Tournament, bracket and stats pages churn constantly and are noise for a news feed.
 * Matching on page SHAPE rather than a name list means it keeps working for events that
 * do not exist yet.
 */
const TOURNAMENT_SHAPE =
  /(\/|\b(19|20)\d{2}\b|\b(League|Cup|Open|Series|Season|Stage|Qualifier|Championship|Masters|Major|Invitational|Playoffs|Circuit|Tour|Showdown|Clash|Split|Division|Conference|Ladder|Statistics|Results|Matches|Group)\b|^(Portal|Template|Category|File|Help|Liquipedia):)/i;

/** Present in a minority of comments, but when present it is a strong confirmation. */
const ROSTER_HINT =
  /\b(roster|lineup|line-?up|transfer|joins?|left|leaves?|benched?|inactive|coach|stand-?in|departure|active squad)\b/i;

/** Player and team page titles are short. Anything longer is almost always an event. */
const MAX_TITLE_WORDS = 4;

/** Edits this close together are treated as one story being written across pages. */
const BURST_WINDOW_MS = 20 * 60 * 1000;
const BURST_MIN_PAGES = 3;

interface Candidate {
  title: string;
  comment: string;
  timestamp: string;
  edits: number;
  hinted: boolean;
  rcid: number;
}

function collect(changes: Change[]): Candidate[] {
  const byTitle = new Map<string, Candidate>();

  for (const change of changes) {
    const title = (change.title ?? "").trim();
    if (!title || TOURNAMENT_SHAPE.test(title)) continue;
    if (title.split(/\s+/).length > MAX_TITLE_WORDS) continue;

    const comment = (change.comment ?? "").trim();
    const hinted = ROSTER_HINT.test(comment);
    const existing = byTitle.get(title);

    if (!existing) {
      byTitle.set(title, {
        title,
        comment,
        timestamp: change.timestamp ?? new Date().toISOString(),
        edits: 1,
        hinted,
        rcid: change.rcid ?? 0,
      });
    } else {
      // Repeated edits to one page are one lead, ranked higher for the activity.
      existing.edits += 1;
      existing.hinted ||= hinted;
      if (hinted && !existing.comment) existing.comment = comment;
    }
  }

  return [...byTitle.values()];
}

/**
 * Groups candidates into time clusters. A burst is ONE story told across several pages —
 * emitting a card per page would mean ten posts about a single roster shuffle, which is
 * how a news account gets muted.
 */
function cluster(candidates: Candidate[]): Candidate[][] {
  const sorted = [...candidates].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );

  const clusters: Candidate[][] = [];
  for (const candidate of sorted) {
    const current = clusters[clusters.length - 1];
    const anchor = current ? Date.parse(current[0].timestamp) : 0;
    if (current && Date.parse(candidate.timestamp) - anchor <= BURST_WINDOW_MS) current.push(candidate);
    else clusters.push([candidate]);
  }
  return clusters;
}

/** Team pages read better as the headline subject than a player page does. */
const TEAM_NAME = /\b(Esports?|Gaming|Team|Club|E-?Sports?|Academy)\b/i;

function leadOf(group: Candidate[]): Candidate {
  return group.find((candidate) => TEAM_NAME.test(candidate.title)) ?? group[0];
}

function pageUrl(title: string): string {
  return `https://liquipedia.net/counterstrike/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

export async function fetchLiquipedia(): Promise<FeedItem[]> {
  const parsed = (await fetchJson(API, 90)) as { query?: { recentchanges?: Change[] } };
  const groups = cluster(collect(parsed.query?.recentchanges ?? []));

  return groups.flatMap((group): FeedItem[] => {
    const lead = leadOf(group);

    if (group.length >= BURST_MIN_PAGES) {
      const others = group.filter((candidate) => candidate !== lead);
      const named = others.slice(0, 4).map((candidate) => candidate.title);
      const rest = others.length - named.length;

      return [
        {
          id: `liquipedia:burst:${lead.title}:${lead.rcid}`,
          source: "liquipedia",
          kind: "roster",
          title: lead.title,
          summary:
            `${group.length} pages edited within ${BURST_WINDOW_MS / 60000} minutes: ` +
            [lead.title, ...named].join(", ") +
            (rest > 0 ? ` +${rest} more` : ""),
          url: pageUrl(lead.title),
          publishedAt: new Date(
            Math.max(...group.map((candidate) => Date.parse(candidate.timestamp))),
          ).toISOString(),
          score: 0,
          reasons: [`burst of ${group.length} pages`],
        },
      ];
    }

    // Outside a burst, a lone edit with no roster keyword is usually a stat fix, not news.
    return group
      .filter((candidate) => candidate.hinted || candidate.edits > 1)
      .map((candidate) => ({
        id: `liquipedia:${candidate.title}:${candidate.rcid}`,
        source: "liquipedia" as const,
        kind: "roster" as const,
        title: candidate.title,
        summary:
          (candidate.comment || "Page edited — no summary given") +
          (candidate.edits > 1 ? ` · ${candidate.edits} edits` : ""),
        url: pageUrl(candidate.title),
        publishedAt: new Date(candidate.timestamp).toISOString(),
        score: 0,
        reasons: [],
      }));
  });
}
