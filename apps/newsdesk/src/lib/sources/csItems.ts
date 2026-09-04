import { USER_AGENT } from "./fetchXml";

/**
 * Resolves a Counter-Strike item name to its official Steam image.
 *
 * A post about "AK-47 | Redline" should show the gun. This is the same principle as a team
 * post wearing the crest, and the reason a files-and-skins account looks credible: the
 * picture is the actual asset, not a stock capsule.
 *
 * Not every match is a real item. "Glock-18 | Floating Camo" is community concept art from
 * Reddit and is deliberately absent from this dataset — a miss here is correct, and the
 * post falls back to the image Reddit attached, which is the artwork itself.
 *
 * The dataset is an unofficial community mirror of Valve's item files, ~5MB, served from a
 * CDN. It is fetched lazily — only when a headline is item-shaped — and held for a day,
 * because items change only when Valve ships an update.
 */
const ITEMS_URL = "https://cdn.jsdelivr.net/gh/ByMykel/CSGO-API@main/public/api/en/skins.json";
const TTL_MS = 24 * 60 * 60 * 1000;

interface Item {
  name?: string;
  image?: string;
}

let index: { byName: Map<string, string>; at: number } | null = null;
let inFlight: Promise<Map<string, string>> | null = null;

function normalise(name: string): string {
  return name.toLowerCase().replace(/★|\(.*?\)|stattrak™|souvenir/gi, "").replace(/\s+/g, " ").trim();
}

async function loadIndex(): Promise<Map<string, string>> {
  if (index && Date.now() - index.at < TTL_MS) return index.byName;
  // Several cards can ask at once on a cold instance; one download serves them all.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const res = await fetch(ITEMS_URL, {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: 86_400 },
    });
    if (!res.ok) throw new Error(`items dataset responded ${res.status}`);

    const byName = new Map<string, string>();
    for (const item of (await res.json()) as Item[]) {
      if (item.name && item.image) byName.set(normalise(item.name), item.image);
    }
    index = { byName, at: Date.now() };
    return byName;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Counter-Strike names every skin "Weapon | Finish", which makes them easy to spot. */
export function itemNameIn(title: string): string | null {
  const match = title.match(/([A-Za-z0-9\-★' ]{2,28}\s\|\s[A-Za-z0-9\-'’. ]{2,30})/);
  return match ? match[1].trim() : null;
}

export async function fetchItemImage(name: string): Promise<string | null> {
  try {
    return (await loadIndex()).get(normalise(name)) ?? null;
  } catch {
    return null;
  }
}
