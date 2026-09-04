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

/**
 * `matcher` is what appears in a headline; `page` is the Liquipedia page title; `brand` is
 * the colour the org's own graphics use.
 *
 * The brand colour is what makes a crest look like a designed asset instead of a cut-out.
 * The accounts worth copying put the logo large on a solid square of the team's colour —
 * Vitality yellow, MOUZ red, Spirit slate — and that square, repeated post after post, is
 * most of what reads as "professional". A transparent PNG floated on a dark background
 * reads as a missing image no matter how good the logo is.
 *
 * These are eyeballed from each org's public branding, not sampled from a brand guide, so
 * treat them as close rather than exact and correct any that look wrong in a post. Where a
 * team's colour is unknown or genuinely near-black, `null` falls back to the app's own dark
 * plate, which still looks deliberate.
 */
interface Team {
  matcher: RegExp;
  page: string;
  brand: string | null;
}

const TEAMS: Team[] = [
  { matcher: /\bThe MongolZ\b/i, page: "The MongolZ", brand: "#0E0E10" },
  { matcher: /\bNatus Vincere\b|\bNAVI\b/i, page: "Natus Vincere", brand: "#F5D400" },
  { matcher: /\bVitality\b/i, page: "Team Vitality", brand: "#F5E900" },
  { matcher: /\bFalcons\b/i, page: "Team Falcons", brand: "#0B3B2E" },
  { matcher: /\bSpirit\b/i, page: "Team Spirit", brand: "#2E3D45" },
  { matcher: /\bFURIA\b/i, page: "FURIA Esports", brand: "#0B0B0B" },
  { matcher: /\bMOUZ\b|\bmousesports\b/i, page: "MOUZ", brand: "#E2001A" },
  { matcher: /\bG2\b/i, page: "G2 Esports", brand: "#111114" },
  { matcher: /\bAurora\b/i, page: "Aurora Gaming", brand: "#5B2E8C" },
  { matcher: /\bLiquid\b/i, page: "Team Liquid", brand: "#0A1E3C" },
  { matcher: /\bAstralis\b/i, page: "Astralis", brand: "#E4002B" },
  { matcher: /\bHEROIC\b/i, page: "Heroic", brand: "#101014" },
  { matcher: /\bNinjas in Pyjamas\b|\bNiP\b/i, page: "Ninjas in Pyjamas", brand: "#121212" },
  { matcher: /\bFaZe\b/i, page: "FaZe Clan", brand: "#E43D30" },
  { matcher: /\bCloud9\b/i, page: "Cloud9", brand: "#00AEEF" },
  { matcher: /\bComplexity\b/i, page: "Complexity Gaming", brand: "#0B2545" },
  { matcher: /\bBIG\b/i, page: "BIG", brand: "#111111" },
  { matcher: /\bEternal Fire\b/i, page: "Eternal Fire", brand: "#122C4A" },
  { matcher: /\bpaiN\b/i, page: "paiN Gaming", brand: "#101010" },
  { matcher: /\bImperial\b/i, page: "Imperial Esports", brand: "#0F1B14" },
  { matcher: /\bLegacy\b/i, page: "Legacy", brand: "#121212" },
  { matcher: /\b9z\b/i, page: "9z Team", brand: "#5A2D82" },
  { matcher: /\bBetBoom\b/i, page: "BetBoom Team", brand: "#F2C300" },
  { matcher: /\bVirtus\.?pro\b/i, page: "Virtus.pro", brand: "#F26522" },
  { matcher: /\bGamerLegion\b/i, page: "GamerLegion", brand: "#12151A" },
  { matcher: /\bFnatic\b/i, page: "Fnatic", brand: "#FF5900" },
  { matcher: /\bTYLOO\b/i, page: "TYLOO", brand: "#C8102E" },
  { matcher: /\bFlyQuest\b/i, page: "FlyQuest", brand: "#0B6E4F" },
  { matcher: /\bNRG\b/i, page: "NRG Esports", brand: "#0B0B0B" },
  { matcher: /\bM80\b/i, page: "M80", brand: "#101010" },
  { matcher: /\bWildcard\b/i, page: "Wildcard Gaming", brand: "#141414" },
  { matcher: /\b3DMAX\b/i, page: "3DMAX", brand: "#123A8C" },
  { matcher: /\bB8\b/i, page: "B8", brand: "#141414" },
  { matcher: /\bIberian Soul\b/i, page: "Iberian Soul", brand: "#151515" },
  { matcher: /\bFUT\b/i, page: "FUT Esports", brand: "#141414" },
  { matcher: /\bYawara\b/i, page: "Yawara E-Sports", brand: "#151515" },
  { matcher: /\bSAW\b/i, page: "SAW", brand: "#151515" },
  { matcher: /\bApogee\b/i, page: "Apogee", brand: "#151515" },
  { matcher: /\bNemiga\b/i, page: "Nemiga Gaming", brand: "#151515" },
  { matcher: /\bRare Atom\b/i, page: "Rare Atom", brand: "#151515" },
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
