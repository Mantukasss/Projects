import { teamInText } from "./teams";

/**
 * Reads a match result out of a headline.
 *
 * The point is an original graphic. A result post wants a scoreboard — two crests, the
 * score, the event — and that is a picture we can draw ourselves from facts that are not
 * anyone's to own. The alternative is reposting a channel's watermarked card, which is what
 * makes an account look like a mirror of a better one.
 *
 * Deliberately conservative. A scoreboard naming the wrong winner is worse than no
 * scoreboard, so anything ambiguous returns null and the post falls back to photographs.
 */
export interface MatchResult {
  winner: string;
  loser: string;
  score?: string;
  event?: string;
}

/** "A defeat B", "A beat B", "A eliminate B" — the shapes results are actually written in. */
const VERB =
  /\b(defeat(?:ed|s)?|beat|beats|eliminate[sd]?|knock(?:ed)? out|overcome|overcame|down(?:ed)?|take down|took down)\b/i;

/** A scoreline, which in Counter-Strike is small numbers either side of a dash. */
const SCORE = /\b(\d{1,2})\s*[-–:]\s*(\d{1,2})\b/;

export function parseResult(title: string): MatchResult | null {
  const verb = title.match(VERB);
  if (!verb?.index) return null;

  const before = title.slice(0, verb.index);
  const after = title.slice(verb.index + verb[0].length);

  // Both sides must resolve to teams we actually recognise, or the crests would be wrong.
  const winner = teamInText(before);
  const loser = teamInText(after);
  if (!winner || !loser || winner === loser) return null;

  const score = after.match(SCORE);
  // A date range reads as a scoreline; a real CS score has no number above 32.
  const plausible =
    score && Number(score[1]) <= 32 && Number(score[2]) <= 32 ? `${score[1]}-${score[2]}` : undefined;

  // Whatever follows "at" is the event, when the headline names one.
  const event = title.match(/\bat\s+([A-Z][\w.'-]*(?:\s+[A-Z0-9][\w.'-]*){0,5})/)?.[1];

  return { winner, loser, score: plausible, event };
}
