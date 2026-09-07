"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaOption } from "@/lib/compose";
import { brandOf } from "@/lib/teams";
import { objectSearchLinks, photoSearchLinks } from "@/lib/photoSearch";

/**
 * The pair of images a post goes out with, both the same square, both ready to share.
 *
 * WHAT GOES IN THE SECOND SLOT, read off @Ozzny_CS2 and @cs2files rather than guessed:
 *
 *   Two people in the story  ->  BOTH FACES. cs2files' "donk on what makes tN1R so good"
 *                                ran donk beside tN1R; Ozzny's MVP count ran donk beside
 *                                NiKo. This is the commonest pair in both accounts.
 *   One person, one org      ->  face + crest on the org's brand colour. cs2files' ruggah
 *                                retirement ran his own photo beside the Astralis star on
 *                                solid red — which is what CrestTile draws.
 *   Neither                  ->  whatever the story actually shipped: the source photo, the
 *                                skin, the game capsule. Still drawn onto the same square.
 *
 * EVERY CANDIDATE IS TRIED, IN ORDER, UNTIL TWO LOAD. This is the fix for a post reaching X
 * as text with no pictures: the component used to render only a player photo and a crest, so
 * a card with neither produced no squares at all, nothing reached the share sheet, and the
 * only route left was X's intent URL — which cannot carry an attachment. Now the planned
 * media are candidates too, so a post that has any picture at all has a shareable one.
 *
 * A slot that comes back empty advances to the next unused candidate rather than giving up.
 */
const SIZE = 1080;
const BG = "#161618";

type Slot = "photo" | "crest";

interface Candidate {
  url: string;
  label: string;
  slot: Slot;
  /** Crests are contained on the org's colour; photographs are cover-cropped. */
  brand?: string | null;
}

/**
 * Ozzny's watermark, bottom-right, on every image he posts.
 *
 * Worth copying and not decoration: the pictures are what travel — screenshotted, reposted,
 * lifted into someone else's thread — and the handle is the only thing that comes with them.
 * cs2files does not do it, so it follows the handle rather than being forced.
 */
function watermark(ctx: CanvasRenderingContext2D, handle: string): void {
  if (!handle || handle === "@your_handle") return;
  ctx.save();
  ctx.font = `500 ${Math.round(SIZE * 0.026)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = Math.round(SIZE * 0.008);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillText(handle, SIZE - SIZE * 0.022, SIZE - SIZE * 0.022);
  ctx.restore();
}

function useSquare(
  candidate: Candidate | null,
  handle: string,
): {
  ref: React.RefObject<HTMLCanvasElement | null>;
  state: "loading" | "ready" | "empty";
  /** The finished square as a data URL, or null when the canvas could not be exported. */
  url: string | null;
} {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");
  const [url, setUrl] = useState<string | null>(null);

  const slot = candidate?.slot ?? "photo";
  const brand = candidate?.brand ?? null;
  const src = candidate?.url ?? null;

  const draw = useCallback(
    (img: HTMLImageElement | null) => {
      const canvas = ref.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      ctx.fillStyle = slot === "crest" ? brand ?? "#1B1B1F" : BG;
      ctx.fillRect(0, 0, SIZE, SIZE);

      if (!img?.width) {
        // Nothing to show. An empty coloured square is worse than no square: it looks like
        // a finished image, so it gets attached, and the post goes out with a blank tile.
        setUrl(null);
        setState("empty");
        return;
      }

      if (slot === "photo") {
        // Cover-crop, biased upward so a head is never cut off by the square.
        const scale = Math.max(SIZE / img.width, SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) * 0.25, w, h);
      } else {
        // Contain, with a wide margin: a crest needs room or it reads as a sticker.
        const box = SIZE * 0.58;
        const scale = Math.min(box / img.width, box / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
      }

      watermark(ctx, handle);

      /**
       * Exported to a data URL so the square can be shown as an <img> AND handed to the
       * share sheet.
       *
       * This is the difference between usable and not on a phone. A <canvas> cannot be
       * long-pressed and saved — iOS offers "Add to Photos" on an <img> and nothing at all
       * on a canvas — and a canvas that cannot be exported cannot become a File either, so
       * the post reaches X with no pictures.
       *
       * It throws when a cross-origin image tainted the canvas, which is why every host the
       * feed draws from is proxied through /api/image rather than loaded direct.
       */
      try {
        setUrl(canvas.toDataURL("image/png"));
      } catch {
        setUrl(null);
      }
      setState("ready");
    },
    [slot, brand, handle],
  );

  useEffect(() => {
    setState("loading");
    if (!src) {
      draw(null);
      return;
    }
    const img = new Image();
    // Requested with CORS so the canvas stays exportable where the host allows it.
    if (/^https?:/i.test(src)) img.crossOrigin = "anonymous";
    img.onload = () => draw(img);
    img.onerror = () => draw(null);
    img.src = src;
  }, [src, draw]);

  return { ref, state, url };
}

/** Returns false when the canvas cannot be exported, so the caller can say what to do. */
function save(canvas: HTMLCanvasElement | null, name: string): boolean {
  if (!canvas) return false;
  try {
    const link = document.createElement("a");
    link.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    return true;
  } catch {
    return false;
  }
}

/**
 * Hosts `/api/image` will re-serve. Mirrors the allowlist in that route.
 *
 * Same-origin is the whole game here. A canvas that has drawn a cross-origin image cannot be
 * exported, and a square that cannot be exported cannot become a File — so it never reaches
 * the share sheet, and the post goes to X as text with no pictures. Proxying makes it ours.
 */
const PROXYABLE = new Set([
  "liquipedia.net",
  "img-cdn.hltv.org",
  "www.hltv.org",
  "clan.fastly.steamstatic.com",
  "clan.akamai.steamstatic.com",
  "cdn.akamai.steamstatic.com",
  "shared.fastly.steamstatic.com",
  "preview.redd.it",
  "i.redd.it",
  "external-preview.redd.it",
  "pbs.twimg.com",
  "static-cdn.jtvnw.net",
  "clips-media-assets2.twitch.tv",
  "i.ytimg.com",
]);

/**
 * HLTV'S OWN CDN CAN NEVER BE MADE EXPORTABLE, and that is not a bug to keep re-testing.
 *
 * It answers 403 to Vercel's runtime, so `/api/image` cannot re-serve it, and it sends no
 * `Access-Control-Allow-Origin`, so a browser cannot load it with CORS either. Both routes to
 * an exportable canvas are closed. Its photos are therefore offered as PLAIN <img> tiles,
 * where press-and-hold still saves them, and they stay out of the composed pair — because a
 * pair that cannot be shared is what sent a post to X with nothing attached.
 */
const UNEXPORTABLE = /img-cdn\.hltv\.org/;

/** Same-origin already, proxied where allowed, null where neither is possible. */
function drawable(url: string): string | null {
  if (url.startsWith("/")) return url;
  try {
    const host = new URL(url).hostname;
    if (UNEXPORTABLE.test(url)) return null;
    return PROXYABLE.has(host) ? `/api/image?url=${encodeURIComponent(url)}` : null;
  } catch {
    return null;
  }
}

export default function PostImages({
  person,
  second,
  teamPage,
  options,
  wiki,
  handle,
  objectWanted,
  onReady,
}: {
  person: string | null;
  /** The other person in the story, when there is one. Takes the second slot from the crest. */
  second: string | null;
  teamPage: string | null;
  /** Everything planMedia found, in its order — the fallback candidates for either slot. */
  options: MediaOption[];
  wiki: "counterstrike" | "valorant";
  /** Watermarked bottom-right, the way Ozzny does. Empty or the placeholder draws nothing. */
  handle: string;
  /** The ordinary thing a quote is about, when the write-up named one. */
  objectWanted: string | null;
  /**
   * Hands the finished squares up as files, so the card can share them with the text.
   *
   * The whole flow — save two pictures, switch app, find them in the camera roll, attach —
   * collapses into one tap if the browser can share files, and this is what makes that
   * possible. Called with an empty array when nothing exported.
   */
  onReady?: (files: File[]) => void;
}) {
  /**
   * HLTV's press photo when they have one, Liquipedia's otherwise, for both people.
   *
   * Asked for per card rather than carried on the feed, because the index lives in one
   * serverless instance's memory and the instance answering the feed is rarely the one that
   * built it — the feed reported no photos while the index itself was fine.
   */
  const [hltvPhoto, setHltvPhoto] = useState<string | null>(null);
  const [hltvSecond, setHltvSecond] = useState<string | null>(null);

  useEffect(() => {
    // A team is a subject too: a post about MOUZ can carry a photograph from an event they
    // were at, which beats their crest twice over.
    const subject = person ?? teamPage;
    let cancelled = false;
    const look = (name: string | null, set: (url: string) => void) => {
      if (!name) return;
      fetch(`/api/hltv-photo?name=${encodeURIComponent(name)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled && data?.url) set(data.url);
        })
        .catch(() => undefined);
    };
    look(subject, setHltvPhoto);
    look(second, setHltvSecond);
    return () => {
      cancelled = true;
    };
  }, [person, second, teamPage]);

  const wikiParam = wiki === "valorant" ? "&wiki=valorant" : "";
  // ItemCard rebuilds `options` (draft.images) on every render, so its ARRAY IDENTITY changes
  // every time even when the contents are identical. Keying the memo and the slot-reset on a
  // string of the urls makes them stable across renders — without it the reset effect below
  // fired every render, resetting the slots, re-rendering, and resetting again: the whole
  // feed twitched. Content, not identity.
  const optionsKey = options.map((o) => o.url).join("|");

  /**
   * Everything this post could put in a square, best first.
   *
   * Faces lead because a story is about people and two faces say who before a word is read.
   * The crest follows. Then whatever the source actually shipped — which is the difference
   * between a post that can be shared with pictures and one that cannot.
   */
  const candidates = useMemo<Candidate[]>(() => {
    const list: Candidate[] = [];
    const push = ({ url, ...rest }: Omit<Candidate, "url"> & { url: string | null }) => {
      if (url && !list.some((existing) => existing.url === url)) list.push({ url, ...rest });
    };

    // Liquipedia's portrait rather than HLTV's, for the composed square: HLTV's is the better
    // photograph and the one this account is imitating, but it cannot be exported, and an
    // unshareable square is worse than a slightly softer one. HLTV's is offered below.
    if (person) {
      push({
        url: `/api/photo?name=${encodeURIComponent(person)}${wikiParam}`,
        label: person,
        slot: "photo",
      });
    }
    if (second && second !== person) {
      push({
        url: `/api/photo?name=${encodeURIComponent(second)}${wikiParam}`,
        label: second,
        slot: "photo",
      });
    }
    if (teamPage) {
      push({
        url: `/api/logo?title=${encodeURIComponent(teamPage)}${wikiParam}`,
        label: teamPage,
        slot: "crest",
        brand: brandOf(teamPage),
      });
    }
    for (const option of options) {
      // A clip is attached as footage, not drawn onto a square.
      if (option.video) continue;
      push({
        url: drawable(option.url),
        label: option.label,
        slot: option.crest ? "crest" : "photo",
        brand: option.crest?.brand ?? null,
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, second, teamPage, optionsKey, wikiParam]);

  /**
   * HLTV's editorial photographs, offered separately because they cannot be composed.
   *
   * See UNEXPORTABLE. Press-and-hold saves a plain <img> even when its source is cross-origin,
   * so these are still one gesture away from the camera roll — they just cannot ride the
   * share sheet with the text.
   */
  const hltvExtras = [
    hltvPhoto ? { url: hltvPhoto, label: person ?? teamPage ?? "photo" } : null,
    hltvSecond && hltvSecond !== hltvPhoto ? { url: hltvSecond, label: second ?? "photo" } : null,
  ].filter((extra): extra is { url: string; label: string } => extra !== null);

  /**
   * Which candidate each slot is showing.
   *
   * Two fixed slots because hooks cannot be called in a loop. A slot whose candidate fails
   * to load advances past the other slot's pick to the next unused one, so a dead URL costs
   * a moment rather than the whole picture.
   */
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(1);

  /**
   * Reset the slots only when the actual set of candidates changes — keyed on their urls, not
   * on the array's identity. This is the line that caused the twitch: `[candidates]` was a
   * fresh array every render, so this ran every render.
   */
  const candidatesKey = candidates.map((c) => c.url).join("|");
  useEffect(() => {
    setLeft(0);
    setRight(1);
  }, [candidatesKey]);

  const a = useSquare(candidates[left] ?? null, handle);
  const b = useSquare(candidates[right] ?? null, handle);

  useEffect(() => {
    if (a.state === "empty" && left < candidates.length) {
      setLeft((current) => {
        let next = current + 1;
        while (next === right) next += 1;
        return next;
      });
    }
  }, [a.state, left, right, candidates.length]);

  useEffect(() => {
    if (b.state === "empty" && right < candidates.length) {
      setRight((current) => {
        let next = current + 1;
        while (next === left) next += 1;
        return next;
      });
    }
  }, [b.state, left, right, candidates.length]);

  const showA = Boolean(candidates[left]) && a.state !== "empty";
  const showB = Boolean(candidates[right]) && b.state !== "empty";
  const both = showA && showB;

  /**
   * Turns the exported squares into files for the share sheet.
   *
   * Runs before any early return, because a hook that only sometimes runs is a React error
   * rather than a subtle bug. The data URLs are the dependency: a redraw makes a new one and
   * the files follow.
   */
  const aUrl = showA ? a.url : null;
  const bUrl = showB ? b.url : null;
  const aName = candidates[left]?.label ?? "image";
  const bName = candidates[right]?.label ?? "image";

  useEffect(() => {
    if (!onReady) return;
    let cancelled = false;
    const wanted = ([[aUrl, aName], [bUrl, bName]] as const).filter(
      (pair): pair is readonly [string, string] => Boolean(pair[0]),
    );
    if (wanted.length === 0) {
      onReady([]);
      return;
    }
    Promise.all(
      wanted.map(async ([url, name]) => {
        const blob = await (await fetch(url)).blob();
        return new File([blob], `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`, {
          type: "image/png",
        });
      }),
    )
      .then((files) => {
        if (!cancelled) onReady(files);
      })
      .catch(() => {
        if (!cancelled) onReady([]);
      });
    return () => {
      cancelled = true;
    };
  }, [aUrl, bUrl, aName, bName, onReady]);

  const [blocked, setBlocked] = useState(false);

  if (!showA && !showB) {
    // Nothing drew. Still say where to find something rather than showing an empty card.
    return person || teamPage ? (
      <SearchHelp subject={(person ?? teamPage) as string} wiki={wiki} object={objectWanted} />
    ) : null;
  }

  const saveBoth = () => {
    if (showA && !save(a.ref.current, aName)) setBlocked(true);
    window.setTimeout(() => {
      if (showB && !save(b.ref.current, bName)) setBlocked(true);
    }, 400);
  };

  /**
   * One tile: the square as an <img> when it exported, the raw canvas when it did not.
   *
   * The <img> is what makes this work on a phone — long-press gives "Add to Photos", which
   * is the gallery X's attach sheet reads from.
   */
  const tile = (
    square: { ref: React.RefObject<HTMLCanvasElement | null>; state: string; url: string | null },
    label: string,
  ) => (
    <button
      onClick={() => {
        if (!save(square.ref.current, label)) setBlocked(true);
      }}
      className="overflow-hidden rounded-xl border border-border text-left"
    >
      <canvas
        ref={square.ref}
        width={SIZE}
        height={SIZE}
        className={square.url ? "hidden" : "w-full"}
      />
      {square.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={square.url} alt={label} className="w-full" />
      )}
      <span className="block px-2 py-1 text-[11px] text-text-muted">
        {label}
        <span className="block text-text-low">
          {square.state !== "ready"
            ? "Drawing…"
            : square.url
              ? "Press and hold to save"
              : "Tap to save"}
        </span>
      </span>
    </button>
  );

  return (
    <div className="mt-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-text-low">
        {both ? "The pair — same square, both ready" : "Only one square — pick a second below"}
      </p>
      <div className={`grid gap-2 ${both ? "grid-cols-2" : "grid-cols-1"}`}>
        {showA && tile(a, aName)}
        {showB && tile(b, bName)}
      </div>

      {both && (
        <button
          onClick={saveBoth}
          className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border text-sm text-text-muted transition-colors duration-150 ease-out hover:text-text"
        >
          Save both squares
        </button>
      )}

      {blocked && (
        <p className="mt-2 text-xs text-amber">
          That one is served by a host that will not let the page export it. Press and hold the
          picture and save it that way.
        </p>
      )}

      {hltvExtras.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-text-low">
            HLTV&apos;s own photo — press and hold to save
          </p>
          <div className={`grid gap-2 ${hltvExtras.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {hltvExtras.map((extra) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={extra.url}
                src={extra.url}
                alt={extra.label}
                loading="lazy"
                className="w-full rounded-xl border border-border"
              />
            ))}
          </div>
          {/* Saying why, because "why is this one not in the pair" is the obvious question. */}
          <p className="mt-1 text-[11px] text-text-low">
            Better photography, but HLTV blocks the page from turning it into a file — so it
            cannot ride the share sheet. Save it and attach it by hand.
          </p>
        </div>
      )}

      {(!both || objectWanted) && (
        <SearchHelp
          subject={(person ?? teamPage ?? "Counter-Strike") as string}
          wiki={wiki}
          object={objectWanted}
        />
      )}
    </div>
  );
}

/** Where to go looking when a slot came up empty, or when the quote wants a picture of a thing. */
function SearchHelp({
  subject,
  wiki,
  object,
}: {
  subject: string;
  wiki: "counterstrike" | "valorant";
  object: string | null;
}) {
  const links = object ? objectSearchLinks(object) : photoSearchLinks(subject, wiki);
  return (
    <div className="mt-2 rounded-md border border-dashed border-border p-2">
      <p className="mb-1 text-xs text-text-muted">
        {object ? (
          <>
            This one is about <span className="text-text">{object}</span> — a picture of it
            beside the face is the pair that works:
          </>
        ) : (
          <>No second picture found for {subject}. Grab one:</>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noreferrer noopener"
            title={link.note}
            className="rounded-md border border-border px-2 py-1 text-xs text-blue"
          >
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}
