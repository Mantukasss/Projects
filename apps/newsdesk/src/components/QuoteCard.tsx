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
  const [subject, setSubject] = useState<HTMLImageElement | null>(null);
  const [tainted, setTainted] = useState(false);

/**
   * The badge, by Liquipedia page title. Served from our own origin, so drawing it leaves
   * the canvas exportable.
   */
  useEffect(() => {
    if (!item.teamPage) return;
    const img = new Image();
    img.onload = () => setLogo(img);
    img.onerror = () => setLogo(null);
    const wiki = item.source === "vlr" ? "&wiki=valorant" : "";
    img.src = `/api/logo?title=${encodeURIComponent(item.teamPage)}${wiki}`;
  }, [item.teamPage, item.source]);

  /**
   * The subject photo — the player, the trophy lift, whatever the source shipped.
   *
   * Loaded straight from the source, and deliberately not through /api/image: HLTV's CDN
   * answers a browser and refuses a server, so the proxy 502s on exactly these. That means
   * it is a cross-origin draw, which taints the canvas and makes Save throw. We attempt it,
   * and if the export turns out to be blocked we redraw without the photo and say so — a
   * card that saves beats a prettier one that does not.
   */
  /**
   * The background photograph.
   *
   * The player's portrait is preferred over the source's own image for two reasons. It
   * comes through our own origin, so drawing it leaves the canvas exportable — a source
   * photo is cross-origin and taints it. And a Telegram item's picture is usually a graphic
   * with Russian text burned into it, which is the exact thing this card exists to replace.
   */
  useEffect(() => {
    const foreign = /[\u0400-\u04FF]/.test(`${item.title} ${item.summary}`);
    const portrait = item.playerName
      ? `/api/photo?name=${encodeURIComponent(item.playerName)}${item.source === "vlr" ? "&wiki=valorant" : ""}`
      : null;
    const src = portrait ?? (foreign ? null : item.image);
    if (!src) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setSubject(img);
    img.onerror = () => setSubject(null);
    img.src = src;
  }, [item.image, item.title, item.summary, item.playerName, item.source]);

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

    /**
     * The photograph fills the card and the words sit on top of it.
     *
     * This is the shape every quote graphic in this scene uses — the player's face full
     * bleed, a dark scrim over the lower half, the quote in heavy type across it. A photo
     * boxed off to one side beside a column of text reads as a slide; this reads as a
     * poster, and the difference is most of why one gets looked at.
     */
    const textWidth = WIDTH - PADDING * 2;
    if (subject && subject.width > 0) {
      const scale = Math.max(WIDTH / subject.width, HEIGHT / subject.height);
      const drawW = subject.width * scale;
      const drawH = subject.height * scale;
      // Bias upward: faces sit in the top half, and the type belongs under them.
      ctx.drawImage(subject, (WIDTH - drawW) / 2, (HEIGHT - drawH) * 0.3, drawW, drawH);

      // The scrim earns the text its contrast without hiding the photograph.
      const scrim = ctx.createLinearGradient(0, HEIGHT * 0.18, 0, HEIGHT);
      scrim.addColorStop(0, "rgba(10,10,12,0)");
      scrim.addColorStop(0.45, "rgba(10,10,12,0.72)");
      scrim.addColorStop(1, "rgba(10,10,12,0.94)");
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, WIDTH, 8);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(0, 0, 220, 8);

    // The badge sits top-right, letterboxed into a fixed box so a wide wordmark and a
    // square crest both land at the same optical weight instead of one dwarfing the other.
    let logoBottom = 0;
    if (logo && logo.width > 0 && logo.height > 0) {
      /**
       * The crest sits on a plate rather than floating on the background.
       *
       * These logos are transparent PNGs drawn for a white wiki page: some are dark, some
       * are wordmarks, some are thin line art, and dropped straight onto a dark card they
       * read as a broken asset. A consistent rounded plate behind them gives every crest
       * the same footprint and the same contrast, which is what makes a set of posts look
       * like one publication instead of a scrape.
       */
      const PLATE = subject ? 128 : 160;
      const inset = PLATE * 0.16;
      const plateX = subject ? PADDING : WIDTH - PADDING - PLATE;
      const plateY = PADDING - 24;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(plateX, plateY, PLATE, PLATE, PLATE * 0.22);
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.94;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.clip();

      const box = PLATE - inset * 2;
      const scale = Math.min(box / logo.width, box / logo.height);
      const width = logo.width * scale;
      const height = logo.height * scale;
      ctx.drawImage(
        logo,
        plateX + (PLATE - width) / 2,
        plateY + (PLATE - height) / 2,
        width,
        height,
      );
      ctx.restore();

      logoBottom = plateY + PLATE;
    }

    // Headline. Shrink the type until the quote fits rather than truncating it —
    // a cut-off quote reads as sloppy and sloppy costs credibility.
    let fontSize = 62;
    let lines: string[] = [];
    do {
      ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      lines = wrap(ctx, headline, textWidth - PADDING);
      fontSize -= 3;
    } while (lines.length * (fontSize * 1.25) > HEIGHT - PADDING * 2 - 190 && fontSize > 24);

    ctx.fillStyle = TEXT;
    ctx.textBaseline = "top";
    const lineHeight = fontSize * 1.28;
    const blockHeight = lines.length * lineHeight;

    // Anchored to the bottom over a photo, centred without one.
    let y = subject
      ? HEIGHT - PADDING - 96 - blockHeight
      : Math.max(PADDING + 10, logoBottom + 30, (HEIGHT - 210 - blockHeight) / 2);

    if (subject && parsed) {
      // The opening mark that every quote graphic in this scene carries.
      ctx.fillStyle = ACCENT;
      ctx.font = `800 ${fontSize * 1.1}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText("\u201C\u201D", PADDING, y - fontSize * 1.15);
      ctx.fillStyle = TEXT;
      ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    }

    for (const line of lines) {
      ctx.fillText(line, PADDING, y);
      y += lineHeight;
    }

    // The sub-head is free text from a feed and can be any length, so wrap it and cap it
    // at two lines rather than letting it run off the edge of the image.
    ctx.font = `500 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = ACCENT;
    const subLines = wrap(ctx, attribution, textWidth - PADDING).slice(0, 2);
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
  }, [attribution, handle, headline, item.url, logo, subject, parsed]);

  useEffect(draw, [draw]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const link = document.createElement("a");
      link.download = `${item.id.replace(/[^a-z0-9]+/gi, "-")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      // The source photo tainted the canvas. Drop it and redraw so the card can be saved;
      // the photo is still on the feed card and can be saved from there.
      setTainted(true);
      setSubject(null);
    }
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
        {tainted && (
          <p className="mt-3 text-xs text-text-muted">
            The source photo could not be baked into the card — it is redrawn without it.
            Save the photo from the feed card and attach both.
          </p>
        )}
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
