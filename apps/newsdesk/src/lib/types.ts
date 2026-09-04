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
  /**
   * Liquipedia page title of the team this item is about, when a headline names one. The
   * card resolves it to a badge so a post about a team goes out wearing that team's crest.
   */
  teamPage?: string;
  /** Nickname of the player this item is about, guessed from the headline. See players.ts. */
  playerName?: string;
  /** Counter-Strike item named in the headline ("AK-47 | Redline"). See csItems.ts. */
  itemName?: string;
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
  /**
   * Everything this post could attach, best first. X shows two side by side and a pair
   * reads as an event where one reads as a caption — but which two tell the story is a
   * judgement made by looking, so they are offered rather than chosen.
   */
  images: import("./compose").MediaOption[];
  /**
   * True when the images on their own do not carry the story and the generated card should
   * be made — a post with no source photo, or a Russian one whose only picture is a
   * screenshot nobody in the audience can read.
   */
  needsCard: boolean;
}
