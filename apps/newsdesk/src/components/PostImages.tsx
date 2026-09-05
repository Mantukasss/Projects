"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { brandOf } from "@/lib/teams";

/**
 * The pair of images a post goes out with: the person on the left, their team on the right,
 * both the same square.
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
): [React.RefObject<HTMLCanvasElement | null>, "loading" | "ready" | "empty"] {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");

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

  return [ref, state];
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
  teamPage,
  wiki,
}: {
  person: string | null;
  teamPage: string | null;
  wiki: "counterstrike" | "valorant";
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

  useEffect(() => {
    if (!person) return;
    let cancelled = false;
    fetch(`/api/hltv-photo?name=${encodeURIComponent(person)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.url) setHltvPhoto(data.url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [person]);

  const photoSrc = person
    ? hltvPhoto ??
      `/api/photo?name=${encodeURIComponent(person)}${wiki === "valorant" ? "&wiki=valorant" : ""}`
    : null;
  const crestSrc = teamPage
    ? `/api/logo?title=${encodeURIComponent(teamPage)}${wiki === "valorant" ? "&wiki=valorant" : ""}`
    : null;

  const [photoRef, photoState] = useSquare(photoSrc, "photo", null);
  const [crestRef, crestState] = useSquare(crestSrc, "crest", teamPage ? brandOf(teamPage) : null);

  const [blocked, setBlocked] = useState<Slot | null>(null);
  const showPhoto = Boolean(photoSrc) && photoState !== "empty";
  const showCrest = Boolean(crestSrc) && crestState !== "empty";
  if (!showPhoto && !showCrest) return null;

  return (
    <div className="mt-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-text-low">
        {showPhoto && showCrest
          ? "The pair — same square, tap each to save"
          : "Only one square available — pick a second below"}
      </p>
      <div className={`grid gap-2 ${showPhoto && showCrest ? "grid-cols-2" : "grid-cols-1"}`}>
        {showPhoto && (
          <button
            onClick={() => {
              if (!save(photoRef.current, person ?? "photo")) setBlocked("photo");
            }}
            className="overflow-hidden rounded-xl border border-border"
          >
            <canvas ref={photoRef} width={SIZE} height={SIZE} className="w-full" />
            <span className="block px-2 py-1 text-[11px] text-text-muted">
              {person}
              <span className="block text-text-low">{photoState === "ready" ? "Tap to save" : "Drawing…"}</span>
            </span>
          </button>
        )}
        {showCrest && (
          <button
            onClick={() => {
              if (!save(crestRef.current, teamPage ?? "crest")) setBlocked("crest");
            }}
            className="overflow-hidden rounded-xl border border-border"
          >
            <canvas ref={crestRef} width={SIZE} height={SIZE} className="w-full" />
            <span className="block px-2 py-1 text-[11px] text-text-muted">
              {teamPage}
              <span className="block text-text-low">{crestState === "ready" ? "Tap to save" : "Drawing…"}</span>
            </span>
          </button>
        )}
      </div>
      {blocked && (
        <p className="mt-2 text-xs text-amber">
          That source will not let the image be saved from the canvas. Press and hold it to
          save the picture directly instead.
        </p>
      )}
    </div>
  );
}
