/**
 * Recognises the team a headline is about, so the post can carry that team's badge.
 *
 * "cobrazera returns to The MongolZ starting five" should go out with The MongolZ crest
 * beside it — the badge is what makes a post look like it came from someone who covers the
 * scene rather than a feed reader. HLTV names the team in the headline; it just does not
 * hand over a logo, so the name is the bridge to Liquipedia's.
 *
 * A plain list rather than anything clever. Team names are irregular, short, and collide
 * with ordinary words, so matching them is a lookup problem, not a pattern problem. It
 * needs occasional updating as orgs come and go, which is cheap and obvious when a post
 * comes out without a badge.
 */

/** `matcher` is what appears in a headline; `page` is the Liquipedia page title. */
interface Team {
  matcher: RegExp;
  page: string;
}

const TEAMS: Team[] = [
  { matcher: /\bThe MongolZ\b/i, page: "The MongolZ" },
  { matcher: /\bNatus Vincere\b|\bNAVI\b/i, page: "Natus Vincere" },
  { matcher: /\bVitality\b/i, page: "Team Vitality" },
  { matcher: /\bFalcons\b/i, page: "Team Falcons" },
  { matcher: /\bSpirit\b/i, page: "Team Spirit" },
  { matcher: /\bFURIA\b/i, page: "FURIA Esports" },
  { matcher: /\bMOUZ\b|\bmousesports\b/i, page: "MOUZ" },
  { matcher: /\bG2\b/i, page: "G2 Esports" },
  { matcher: /\bAurora\b/i, page: "Aurora Gaming" },
  { matcher: /\bLiquid\b/i, page: "Team Liquid" },
  { matcher: /\bAstralis\b/i, page: "Astralis" },
  { matcher: /\bHEROIC\b/i, page: "Heroic" },
  { matcher: /\bNinjas in Pyjamas\b|\bNiP\b/i, page: "Ninjas in Pyjamas" },
  { matcher: /\bFaZe\b/i, page: "FaZe Clan" },
  { matcher: /\bCloud9\b/i, page: "Cloud9" },
  { matcher: /\bComplexity\b/i, page: "Complexity Gaming" },
  { matcher: /\bBIG\b/i, page: "BIG" },
  { matcher: /\bEternal Fire\b/i, page: "Eternal Fire" },
  { matcher: /\bpaiN\b/i, page: "paiN Gaming" },
  { matcher: /\bImperial\b/i, page: "Imperial Esports" },
  { matcher: /\bLegacy\b/i, page: "Legacy" },
  { matcher: /\b9z\b/i, page: "9z Team" },
  { matcher: /\bBetBoom\b/i, page: "BetBoom Team" },
  { matcher: /\bVirtus\.?pro\b/i, page: "Virtus.pro" },
  { matcher: /\bGamerLegion\b/i, page: "GamerLegion" },
  { matcher: /\bFnatic\b/i, page: "Fnatic" },
  { matcher: /\bTYLOO\b/i, page: "TYLOO" },
  { matcher: /\bFlyQuest\b/i, page: "FlyQuest" },
  { matcher: /\bNRG\b/i, page: "NRG Esports" },
  { matcher: /\bM80\b/i, page: "M80" },
  { matcher: /\bWildcard\b/i, page: "Wildcard Gaming" },
  { matcher: /\b3DMAX\b/i, page: "3DMAX" },
  { matcher: /\bB8\b/i, page: "B8" },
  { matcher: /\bIberian Soul\b/i, page: "Iberian Soul" },
  { matcher: /\bFUT\b/i, page: "FUT Esports" },
  { matcher: /\bYawara\b/i, page: "Yawara E-Sports" },
  { matcher: /\bSAW\b/i, page: "SAW" },
  { matcher: /\bApogee\b/i, page: "Apogee" },
  { matcher: /\bNemiga\b/i, page: "Nemiga Gaming" },
  { matcher: /\bRare Atom\b/i, page: "Rare Atom" },
];

/**
 * True for a page title this module put forward. The logo route trusts these outright: the
 * shape heuristic it otherwise uses rejects perfectly real orgs whose names carry none of
 * the giveaway words — "The MongolZ", "Astralis", "Fnatic" — and silently dropped their
 * badges.
 */
export function isKnownTeam(page: string): boolean {
  return TEAMS.some((team) => team.page === page);
}

/** The first team named in the text, or null. Longest match wins over first position. */
export function teamInText(text: string): string | null {
  let best: { page: string; at: number } | null = null;
  for (const team of TEAMS) {
    const found = text.match(team.matcher);
    if (found?.index === undefined) continue;
    if (!best || found.index < best.at) best = { page: team.page, at: found.index };
  }
  return best?.page ?? null;
}
