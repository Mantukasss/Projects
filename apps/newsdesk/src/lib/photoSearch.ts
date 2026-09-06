/**
 * Where to go looking when the automatic photo comes up empty.
 *
 * The index only holds who has been in HLTV's news lately, so a player who has not led an
 * article recently resolves to nothing — and a post with no picture does not get made. These
 * links close that gap by hand in about ten seconds, which beats waiting for coverage to
 * catch up or posting without an image.
 *
 * Ordered by how likely the result is to look like the rest of the feed: HLTV first because
 * that is the photography this account is imitating, then the wikis, then open search.
 */
export interface PhotoLink {
  label: string;
  url: string;
  note?: string;
}

export function photoSearchLinks(subject: string, wiki: "counterstrike" | "valorant"): PhotoLink[] {
  const q = encodeURIComponent(subject);
  return [
    {
      label: "HLTV",
      url: `https://www.hltv.org/search?query=${q}`,
      note: "their own event photography — first choice",
    },
    {
      label: "Liquipedia",
      url: `https://liquipedia.net/${wiki}/index.php?search=${q}`,
      note: "portrait on the player page",
    },
    {
      label: "Google Images",
      url: `https://www.google.com/search?tbm=isch&tbs=isz:l&q=${q}+CS2`,
      note: "filtered to large images",
    },
  ];
}
