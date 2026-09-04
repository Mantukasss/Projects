"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchResult } from "@/lib/results";
import { brandOf } from "@/lib/teams";

/**
 * A scoreboard drawn from the result itself: both crests on their own brand colours, the
 * score between them, the event underneath.
 *
 * This is the answer to reposting a watermarked graphic. The facts in a result belong to
 * nobody, so the picture of them can be ours — and a scoreboard in a consistent house style,
 * match after match, is the thing readers come to recognise. It is also the one image that
 * says everything the post says without being read.
 */
const WIDTH = 1200;
const HEIGHT = 675;
const NEUTRAL = "#1B1B1F";

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export default function ResultCard({
  result,
  handle,
  onClose,
}: {
  result: MatchResult;
  handle: string;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  const draw = useCallback(async () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const half = WIDTH / 2;
    // Each side wears its own colour, so the split reads as two teams before anything else.
    ctx.fillStyle = brandOf(result.winner) ?? NEUTRAL;
    ctx.fillRect(0, 0, half, HEIGHT);
    ctx.fillStyle = brandOf(result.loser) ?? NEUTRAL;
    ctx.fillRect(half, 0, half, HEIGHT);

    // The loser's half is dimmed: the result should be readable at a glance.
    ctx.fillStyle = "rgba(10,10,12,0.45)";
    ctx.fillRect(half, 0, half, HEIGHT);

    const [winnerLogo, loserLogo] = await Promise.all([
      loadImage(`/api/logo?title=${encodeURIComponent(result.winner)}`),
      loadImage(`/api/logo?title=${encodeURIComponent(result.loser)}`),
    ]);

    const crest = (img: HTMLImageElement | null, centreX: number) => {
      if (!img?.width) return;
      const box = 260;
      const scale = Math.min(box / img.width, box / img.height);
      ctx.drawImage(
        img,
        centreX - (img.width * scale) / 2,
        HEIGHT * 0.34 - (img.height * scale) / 2,
        img.width * scale,
        img.height * scale,
      );
    };
    crest(winnerLogo, half / 2);
    crest(loserLogo, half + half / 2);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(result.winner, half / 2, HEIGHT * 0.62);
    ctx.fillText(result.loser, half + half / 2, HEIGHT * 0.62);

    if (result.score) {
      // The score sits in a band across the seam so neither side owns it.
      ctx.fillStyle = "rgba(10,10,12,0.82)";
      ctx.fillRect(0, HEIGHT * 0.70, WIDTH, 110);
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 68px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(result.score, half, HEIGHT * 0.70 + 26);
    }

    if (result.event) {
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.font = `500 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(result.event, half, HEIGHT - 74);
    }

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = `400 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(handle, half, HEIGHT - 40);

    setReady(true);
  }, [result, handle]);

  useEffect(() => {
    void draw();
  }, [draw]);

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    const link = document.createElement("a");
    link.download = `${result.winner}-${result.loser}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-t-3xl border border-white/10 bg-surface p-4 shadow-[0_8px_24px_rgba(0,0,0,0.5)] sm:rounded-2xl"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        onClick={(event) => event.stopPropagation()}
      >
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="w-full rounded-xl border border-border" />
        <div className="mt-4 flex gap-2">
          <button
            onClick={save}
            disabled={!ready}
            className="min-h-11 flex-1 rounded-md bg-amber font-medium text-black transition-colors duration-150 ease-out disabled:opacity-50"
          >
            Save scoreboard
          </button>
          <button
            onClick={onClose}
            className="min-h-11 rounded-md border border-border px-5 text-text-muted transition-colors duration-150 ease-out hover:text-text"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
