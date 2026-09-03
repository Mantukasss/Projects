"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedItem } from "@/lib/types";
import { splitQuote } from "@/lib/compose";

/**
 * Generates the post's image when the source didn't ship one.
 *
 * Rule 2 of the playbook: every post carries media. A text-only post in this niche gets
 * scrolled past, so a card is not decoration — it is the difference between a post that
 * reaches and one that doesn't. Drawn on a canvas so it costs nothing to run.
 */

const WIDTH = 1200;
const HEIGHT = 675;
const PADDING = 80;

const BG = "#161618";
const SURFACE = "#232326";
const TEXT = "#ededef";
const MUTED = "#a09fa6";
const ACCENT = "#ffb224";

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export default function QuoteCard({
  item,
  handle,
  onClose,
}: {
  item: FeedItem;
  handle: string;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);

  /**
   * Both routes serve from our own origin, so drawing the result does not taint the canvas
   * and break Save. When the source shipped an image we proxy it; when it did not — the
   * Liquipedia roster leads — we ask for the team badge by page title, and /api/logo
   * answers 404 for anything that is not a team, which just leaves the card text-only.
   */
  useEffect(() => {
    const src = item.image
      ? `/api/image?url=${encodeURIComponent(item.image)}`
      : item.source === "liquipedia"
        ? `/api/logo?title=${encodeURIComponent(item.title)}`
        : null;
    if (!src) return;

    const img = new Image();
    img.onload = () => setLogo(img);
    img.onerror = () => setLogo(null);
    img.src = src;
  }, [item.image, item.source, item.title]);

  const parsed = splitQuote(item.title);
  // A quote leads with the words and credits the speaker underneath. Anything else leads
  // with its headline and uses the detail line as the sub-head.
  const headline = parsed ? `"${parsed.quote}"` : item.title;
  const attribution = parsed ? parsed.speaker : item.summary;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, WIDTH, 8);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(0, 0, 220, 8);

    // The badge sits top-right, letterboxed into a fixed box so a wide wordmark and a
    // square crest both land at the same optical weight instead of one dwarfing the other.
    let logoBottom = 0;
    if (logo && logo.width > 0 && logo.height > 0) {
      const BOX = 150;
      const scale = Math.min(BOX / logo.width, BOX / logo.height);
      const width = logo.width * scale;
      const height = logo.height * scale;
      ctx.drawImage(logo, WIDTH - PADDING - width, PADDING - 20, width, height);
      logoBottom = PADDING - 20 + height;
    }

    // Headline. Shrink the type until the quote fits rather than truncating it —
    // a cut-off quote reads as sloppy and sloppy costs credibility.
    let fontSize = 62;
    let lines: string[] = [];
    do {
      ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      lines = wrap(ctx, headline, WIDTH - PADDING * 2);
      fontSize -= 3;
    } while (lines.length * (fontSize * 1.25) > HEIGHT - PADDING * 2 - 190 && fontSize > 24);

    ctx.fillStyle = TEXT;
    ctx.textBaseline = "top";
    const lineHeight = fontSize * 1.28;
    const blockHeight = lines.length * lineHeight;
    let y = Math.max(PADDING + 10, logoBottom + 30, (HEIGHT - 210 - blockHeight) / 2);
    for (const line of lines) {
      ctx.fillText(line, PADDING, y);
      y += lineHeight;
    }

    // The sub-head is free text from a feed and can be any length, so wrap it and cap it
    // at two lines rather than letting it run off the edge of the image.
    ctx.font = `500 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = ACCENT;
    const subLines = wrap(ctx, attribution, WIDTH - PADDING * 2).slice(0, 2);
    subLines.forEach((line, index) => {
      const isLast = index === subLines.length - 1;
      const truncated =
        isLast && subLines.length === 2 && attribution.length > subLines.join(" ").length
          ? `${line.replace(/\s+\S*$/, "")}…`
          : line;
      ctx.fillText(truncated, PADDING, HEIGHT - PADDING - 46 - (subLines.length - 1 - index) * 38);
    });

    ctx.font = `400 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = MUTED;
    ctx.fillText(handle, PADDING, HEIGHT - PADDING + 2);

    const sourceLabel = new URL(item.url).hostname.replace(/^www\./, "");
    const labelWidth = ctx.measureText(sourceLabel).width;
    ctx.fillText(sourceLabel, WIDTH - PADDING - labelWidth, HEIGHT - PADDING + 2);

    setReady(true);
  }, [attribution, handle, headline, item.url, logo]);

  useEffect(draw, [draw]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${item.id.replace(/[^a-z0-9]+/gi, "-")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-t-3xl border border-white/10 bg-surface p-4 shadow-[0_8px_24px_rgba(0,0,0,0.5)] sm:rounded-2xl"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        onClick={(event) => event.stopPropagation()}
      >
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="w-full rounded-xl border border-border"
        />
        <div className="mt-4 flex gap-2">
          <button
            onClick={download}
            disabled={!ready}
            className="min-h-11 flex-1 rounded-md bg-amber font-medium text-black transition-colors duration-150 ease-out disabled:opacity-50"
          >
            Save image
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
