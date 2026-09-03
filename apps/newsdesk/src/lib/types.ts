export type SourceId =
  | "hltv"
  | "liquipedia"
  | "reddit"
  | "steam"
  | "telegram"
  | "vlr";

/** How the item should be turned into a post. Drives the template in compose.ts. */
export type Kind = "quote" | "roster" | "result" | "news";

export interface FeedItem {
  /** Stable across refetches — used for dedupe and for the seen-list in localStorage. */
  id: string;
  source: SourceId;
  kind: Kind;
  title: string;
  summary: string;
  /** Canonical source URL. Never goes in the post body — it belongs in reply 1. */
  url: string;
  /** ISO timestamp the source published it. */
  publishedAt: string;
  /** Direct image URL from the source, when it ships one. */
  image?: string;
  /**
   * Set when the headline promises something the post does not deliver: `"list"` for teams
   * or a lineup, `"number"` for a record or a milestone. Such a post is not postable as-is;
   * the card blocks it until the detail is pulled in. The kind matters — a record story
   * enriched with a team list would be absurd — so /api/detail's answer is chosen by it.
   */
  incomplete?: "list" | "number";
  /** The rival account that already covered this, when one has. See rivals.ts. */
  scooped?: string;
  /** Higher = post this sooner. See score.ts. */
  score: number;
  /** Why it scored what it scored — shown in the UI so the ranking is inspectable. */
  reasons: string[];
}

export interface Draft {
  /** The post body. Contains no URL, by design. */
  body: string;
  /** The follow-up reply carrying the source link. */
  reply: string;
  /** Filled when the source gave us an image we can attach directly. */
  image?: string;
  /**
   * The second image. X shows two attachments side by side, and a Valve update post reads
   * far better as "here are the notes" plus "here is the game" than as one lonely card —
   * which is how the accounts that own this beat actually post an update.
   */
  secondImage?: string;
  /** True when there is no source image, so the quote card is the media. */
  needsCard: boolean;
}
