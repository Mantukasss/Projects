/**
 * Pulls the player a headline is about, so the post can carry their photo.
 *
 * Unlike teams, players cannot be a curated list — the scene has thousands and the roster
 * churn is the news. But CS and VALORANT headlines are written to a small number of shapes,
 * and the nickname is almost always the first thing in them. That is enough: a wrong guess
 * costs nothing, because the photo lookup simply 404s and the post falls back to the crest.
 */

/** `nickname: "quote"` — how every interview headline is written. */
const QUOTE = /^([A-Za-z0-9_.\-]{2,20}):\s*["“]/;

/**
 * `nickname <verb> ...` — the roster-move shape. The verb list is what keeps this from
 * matching every headline that happens to start with a capitalised word.
 */
const ACTION =
  /^([A-Za-z0-9_.\-]{2,20})\s+(?:returns?|rejoins?|joins?|leaves?|signs?|departs?|steps?|moves?|benched|sets?|breaks?|ends?|extends?|retires?|becomes?)\b/i;

/** Words that open a headline but are never a player. */
const NOT_A_PLAYER = /^(the|a|an|new|team|hltv|valve|update|report|breaking|just|rumor)$/i;

export function playerInText(title: string): string | null {
  const found = title.match(QUOTE)?.[1] ?? title.match(ACTION)?.[1] ?? null;
  if (!found || NOT_A_PLAYER.test(found)) return null;
  return found;
}
