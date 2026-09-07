"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { brandOf } from "@/lib/teams";
import { photoSearchLinks } from "@/lib/photoSearch";

/**
 * The pair of images a post goes out with, both the same square.
 *
 * WHAT GOES IN THE SECOND SLOT, read off @Ozzny_CS2 and @cs2files rather than guessed:
 *
 *   Two people in the story  ->  BOTH FACES. cs2files' "donk on what makes tN1R so good"
 *                                ran donk beside tN1R; Ozzny's MVP count ran donk beside
 *                                NiKo. This is the commonest pair in both accounts and the
 *                                one this component used to be incapable of making.
 *   One person, one org      ->  face + crest on the org's brand colour. cs2files' ruggah
 *                                retirement ran his own photo beside the Astralis star on
 *                                solid red — which is exactly what CrestTile draws.
 *   One person, no org       ->  the face alone, and pick a second below.
 *
 * The crest is the FALLBACK, not the default. A second face is always the stronger pair
 * because a story is about people, and two faces tell you who before you read a word.
 *
 * Matching dimensions is the whole point and the thing that was missing. X lays two
 * attachments side by side and crops them to a shared height, so a tall portrait beside a
 * wide capsule gets butchered into two mismatched slivers — which is the "weird shit" in a
 * feed of otherwise identical posts. Rendering both onto the same 1080 square means the
 * pair always sits flush, every post, without anyone thinking about it.
 *
 * 1080 because X serves attachments at up to 1080 wide before recompressing; larger costs
 * upload time and buys nothing.
 */
const SIZE = 1080;
const BG = "#161618";

type Slot = "photo" | "crest";

function useSquare(
  src: string | null,
  slot: Slot,
  brand: string | null,
): {
  ref: React.RefObject<HTMLCanvasElement | null>;
  state: "loading" | "ready" | "empty";
  /** The finished square as a data URL, or null when the canvas is tainted. */
  url: string | null;
} {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");
  const [url, setUrl] = useState<string | null>(null);

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
        setState("empty");
        return;
      }

      {
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
      }
      /**
       * Exported to a data URL so the square can be shown as an <img>.
       *
       * This is the difference between usable and not on a phone. A <canvas> cannot be
       * long-pressed and saved: iOS offers "Add to Photos" on an <img> and nothing at all on
       * a canvas, so the only way to get the picture into the camera roll — which is where
       * X's attach sheet looks — was a download link that Safari handles badly. As an
       * <img> the native gesture just works.
       *
       * Throws when a cross-origin photo tainted the canvas, which is not an error worth
       * surfacing: the canvas still renders, so the tile looks right and only the save falls
       * back to the download button.
       */
      try {
        setUrl(canvas.toDataURL("image/png"));
      } catch {
        setUrl(null);
      }
      setState("ready");
    },
    [slot, brand],
  );

  useEffect(() => {
    if (!src) {
      draw(null);
      return;
    }
    const img = new Image();
    /**
     * Requested with CORS so the canvas stays exportable when the host allows it. HLTV
     * serves through imgix, which usually does; if it does not, the draw still succeeds and
     * only the save is blocked — which the button below reports rather than swallowing.
     */
    if (/^https?:/i.test(src)) img.crossOrigin = "anonymous";
    img.onload = () => draw(img);
    img.onerror = () => draw(null);
    img.src = src;
  }, [src, draw]);

  return { ref, state, url };
}

/**
 * Returns false when the canvas cannot be exported.
 *
 * A cross-origin photo drawn without CORS taints the canvas and makes toDataURL throw. That
 * used to be swallowed, so tapping Save did nothing at all and looked like a broken app —
 * the caller now says what to do instead.
 */
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

export default function PostImages({
  person,
  second,
  teamPage,
  wiki,
  onReady,
}: {
  person: string | null;
  /** The other person in the story, when there is one. Takes the second slot from the crest. */
  second: string | null;
  teamPage: string | null;
  wiki: "counterstrike" | "valorant";
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
   * HLTV's press photo when they have one, Liquipedia's otherwise.
   *
   * Asked for per card rather than carried on the feed, because the index lives in one
   * serverless instance's memory and the instance answering the feed is rarely the one
   * that built it — the feed reported no photos while the index itself was fine. The
   * dedicated route waits for the index, so a card's answer is complete.
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

  const photoSrc =
    hltvPhoto ??
    (person
      ? `/api/photo?name=${encodeURIComponent(person)}${wiki === "valorant" ? "&wiki=valorant" : ""}`
      : null);
  /**
   * The second slot: the other person's face where the story has one, the crest otherwise.
   *
   * Both are requested — a second face can fail to resolve, and dropping to the crest is
   * better than dropping to nothing — but only one is shown, the face first.
   */
  const secondSrc =
    second && second !== person
      ? (hltvSecond ??
        `/api/photo?name=${encodeURIComponent(second)}${wiki === "valorant" ? "&wiki=valorant" : ""}`)
      : null;
  const crestSrc = teamPage
    ? `/api/logo?title=${encodeURIComponent(teamPage)}${wiki === "valorant" ? "&wiki=valorant" : ""}`
    : null;

  const photo = useSquare(photoSrc, "photo", null);
  const face2 = useSquare(secondSrc, "photo", null);
  const crest = useSquare(crestSrc, "crest", teamPage ? brandOf(teamPage) : null);

  const [blocked, setBlocked] = useState<Slot | null>(null);
  const showPhoto = Boolean(photoSrc) && photo.state !== "empty";
  const showFace2 = Boolean(secondSrc) && face2.state !== "empty";
  // A second face wins the slot; the crest only fills it when there is no second face.
  const showCrest = !showFace2 && Boolean(crestSrc) && crest.state !== "empty";
  const both = showPhoto && (showFace2 || showCrest);

  /**
   * Turns the exported squares into files for the share sheet.
   *
   * Runs before the early return below, because a hook that only sometimes runs is a React
   * error rather than a subtle bug. The data URLs are the dependency: a redraw produces a
   * new one, and the files follow.
   */
  const leftUrl = showPhoto ? photo.url : null;
  const rightUrl = showFace2 ? face2.url : showCrest ? crest.url : null;
  const leftName = person ?? "photo";
  const rightName = (showFace2 ? second : teamPage) ?? "second";

  useEffect(() => {
    if (!onReady) return;
    let cancelled = false;
    const wanted = [
      [leftUrl, leftName] as const,
      [rightUrl, rightName] as const,
    ].filter((pair): pair is readonly [string, string] => Boolean(pair[0]));

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
  }, [leftUrl, rightUrl, leftName, rightName, onReady]);

  if (!showPhoto && !showFace2 && !showCrest) return null;

  /**
   * Saves both squares in one tap.
   *
   * Two download clicks in the same tick get collapsed to one by every browser that has a
   * "downloading multiple files" prompt, so the second is deferred a beat. It is a hack and
   * it is the standard one.
   */
  const saveBoth = () => {
    if (showPhoto && !save(photo.ref.current, person ?? "photo")) setBlocked("photo");
    window.setTimeout(() => {
      if (showFace2 && !save(face2.ref.current, second ?? "photo")) setBlocked("photo");
      else if (showCrest && !save(crest.ref.current, teamPage ?? "crest")) setBlocked("crest");
    }, 400);
  };

  /**
   * One tile: the square as an <img> when it exported, the raw canvas when it did not.
   *
   * The <img> is what makes this work on a phone — long-press gives "Add to Photos", which
   * is the gallery X's attach sheet reads from. The canvas is the fallback for a tainted
   * export, where tapping still triggers a download.
   */
  const tile = (
    slot: Slot,
    square: { ref: React.RefObject<HTMLCanvasElement | null>; state: string; url: string | null },
    label: string | null,
  ) => (
    <button
      onClick={() => {
        if (!save(square.ref.current, label ?? slot)) setBlocked(slot);
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
        <img src={square.url} alt={label ?? slot} className="w-full" />
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
        {showPhoto && tile("photo", photo, person)}
        {showFace2 && tile("photo", face2, second)}
        {showCrest && tile("crest", crest, teamPage)}
      </div>

      {both && (
        <button
          onClick={saveBoth}
          className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border text-sm text-text-muted transition-colors duration-150 ease-out hover:text-text"
        >
          Save both squares
        </button>
      )}

      {/* No photograph resolved. Rather than leaving the post imageless, point at where one
          is, HLTV first because that is the look being matched. */}
      {!showPhoto && (person || teamPage) && (
        <div className="mt-2 rounded-md border border-dashed border-border p-2">
          <p className="mb-1 text-xs text-text-muted">
            No photo found for {person ?? teamPage}. Grab one:
          </p>
          <div className="flex flex-wrap gap-2">
            {photoSearchLinks((person ?? teamPage) as string, wiki).map((link) => (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-md border border-border px-2 py-1 text-xs text-blue"
                title={link.note}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {blocked && (
        <p className="mt-2 text-xs text-amber">
          That source will not let the image be saved from the canvas. Press and hold it to
          save the picture directly instead.
        </p>
      )}
    </div>
  );
}
