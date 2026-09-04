"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The team crest as a finished post image: the logo large on the org's own brand colour,
 * filling a square.
 *
 * This is the single change that makes a feed of posts look like a publication. The
 * accounts that own this beat pair a photograph with exactly this — Vitality on yellow,
 * MOUZ on red, NAVI on yellow — and repeated post after post it becomes recognisably
 * theirs. The same logo dropped transparent onto a dark background reads as an asset that
 * failed to load, which is what this app was doing.
 *
 * Drawn client-side because the crest is served from our own origin, so the canvas stays
 * exportable and the viewer can save the result straight to their phone.
 */
const SIZE = 1000;
/** Where a brand colour is unknown, the app's own surface still reads as deliberate. */
const FALLBACK = "#1B1B1F";

export default function CrestTile({
  logoUrl,
  brand,
  label,
  onFailed,
}: {
  logoUrl: string;
  brand: string | null;
  label: string;
  onFailed: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  const draw = useCallback(
    (logo: HTMLImageElement) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const background = brand ?? FALLBACK;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, SIZE, SIZE);

      // A single soft diagonal keeps a flat colour from looking like an empty swatch.
      const sheen = ctx.createLinearGradient(0, 0, SIZE, SIZE);
      sheen.addColorStop(0, "rgba(255,255,255,0.10)");
      sheen.addColorStop(0.55, "rgba(255,255,255,0)");
      sheen.addColorStop(1, "rgba(0,0,0,0.18)");
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, SIZE, SIZE);

      // Generous margin: the crest should dominate without touching the edges.
      const box = SIZE * 0.62;
      const scale = Math.min(box / logo.width, box / logo.height);
      const width = logo.width * scale;
      const height = logo.height * scale;
      ctx.drawImage(logo, (SIZE - width) / 2, (SIZE - height) / 2, width, height);

      setReady(true);
    },
    [brand],
  );

  useEffect(() => {
    const img = new Image();
    img.onload = () => draw(img);
    img.onerror = onFailed;
    img.src = logoUrl;
  }, [logoUrl, draw, onFailed]);

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    const link = document.createElement("a");
    link.download = `${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <button
      onClick={save}
      className="block overflow-hidden rounded-xl border border-border text-left transition-colors duration-150 ease-out hover:border-border-focus"
    >
      <canvas ref={canvasRef} width={SIZE} height={SIZE} className="h-28 w-full object-contain" />
      <span className="block px-2 py-1 text-[11px] text-text-muted">
        {label}
        <span className="block text-text-low">{ready ? "Tap to save" : "Drawing…"}</span>
      </span>
    </button>
  );
}
