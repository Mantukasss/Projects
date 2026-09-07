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

/**
 * Where to find a picture of the THING a quote is about, rather than of the person saying it.
 *
 * This is the pattern behind the best-performing post in the sample studied. magixx explained
 * that he reset by starting to drink water; @Ozzny_CS2 ran his face beside a stock photograph
 * of a glass of water, and it took 1,576 likes against 119 for the same account's stat post.
 * The pair is the joke. A second player portrait could not have made it.
 *
 * Deliberately links rather than an automatic fetch. Free image search APIs either do not
 * exist or return whatever is cheapest to serve, and an image chosen badly here is worse than
 * none — it is the half of the pair carrying the punchline. Ten seconds and a human eye.
 *
 * Openverse and Wikimedia first because both are openly licensed, which matters more for a
 * generic object than for a press photo: this is the one slot where the picture is not news
 * photography and there is no fair-use argument to lean on.
 */
export function objectSearchLinks(subject: string): PhotoLink[] {
  const q = encodeURIComponent(subject);
  return [
    {
      label: "Openverse",
      url: `https://openverse.org/search/image?q=${q}`,
      note: "openly licensed — safest for a generic object",
    },
    {
      label: "Wikimedia",
      url: `https://commons.wikimedia.org/w/index.php?search=${q}&type=image`,
      note: "public domain and CC",
    },
    {
      label: "Google Images",
      url: `https://www.google.com/search?tbm=isch&tbs=isz:l&q=${q}`,
      note: "filtered to large images",
    },
  ];
}
