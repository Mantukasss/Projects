"use client";

import { useState } from "react";
import {
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconLanguage,
  IconListDetails,
  IconPhotoPlus,
} from "@tabler/icons-react";
import type { FeedItem } from "@/lib/types";
import { SOURCE_NAME, compose, composeWithDetail, postLength } from "@/lib/compose";

const SOURCE_TONE: Record<FeedItem["source"], string> = {
  hltv: "text-amber",
  liquipedia: "text-purple",
  reddit: "text-coral",
  steam: "text-blue",
  telegram: "text-teal",
  vlr: "text-green",
};

function age(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function ItemCard({
  item,
  handle,
  posted,
  cardMade,
  onTogglePosted,
  onMakeCard,
}: {
  item: FeedItem;
  handle: string;
  posted: boolean;
  cardMade: boolean;
  onTogglePosted: () => void;
  onMakeCard: () => void;
}) {
  const [detail, setDetail] = useState<{ teams: string[]; keyFact: string | null; images: string[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [copied, setCopied] = useState<"body" | "reply" | null>(null);
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  // Cyrillic in the text means this needs translating before it can go out in English.
  const needsTranslation = /[\u0400-\u04FF]/.test(`${item.title} ${item.summary}`);

  const translate = async () => {
    setTranslating(true);
    setTranslateError(null);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `${item.title}\n${item.summary}`.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.text) setTranslated(data.text);
      else setTranslateError(data.error ?? "translation failed");
    } catch {
      setTranslateError("translation failed");
    } finally {
      setTranslating(false);
    }
  };

  // Once the detail is loaded the draft carries the list or the figure; until then it is
  // the bare headline. A translated post replaces the headline entirely — the Russian is
  // never what goes out.
  const source = translated ? { ...item, title: translated, summary: "" } : item;
  const draft = detail ? composeWithDetail(source, detail) : compose(source);

  // A post whose headline promises a list or a number it does not contain must not be
  // copyable. The block is easier to fix than to bypass — one tap loads the detail.
  const resolved =
    detail !== null &&
    (detail.teams.length > 0 || Boolean(detail.keyFact) || detail.images.length > 0);

  // Images found inside the article — the qualified-teams graphic and the like. The lead
  // image already arrives with the feed, so only the extra ones are offered here.
  const extraImages = (detail?.images ?? []).filter((src) => src !== item.image);

  /**
   * A post with no media does not get to leave. In this niche an image is not decoration —
   * it is what makes a post look like reporting rather than a scraped headline, and a
   * text-only post gets scrolled past whatever it says.
   *
   * "Has media" means the source shipped a photo, or the card was made. Every item can
   * reach the second state in one tap, so this is a nudge rather than a wall.
   */
  const hasMedia =
    Boolean(draft.image) || Boolean(draft.secondImage) || extraImages.length > 0 || cardMade;

  const blocked =
    (Boolean(item.incomplete) && detail === null) ||
    (needsTranslation && !translated) ||
    !hasMedia;

  const loadDetail = async () => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/detail?url=${encodeURIComponent(item.url)}`);
      const data = await res.json();
      setDetail({
        teams: Array.isArray(data.teams) ? data.teams : [],
        keyFact: typeof data.keyFact === "string" ? data.keyFact : null,
        images: Array.isArray(data.images) ? data.images : [],
      });
    } catch {
      setDetail({ teams: [], keyFact: null, images: [] });
    } finally {
      setLoadingDetail(false);
    }
  };

  const copy = async (what: "body" | "reply") => {
    await navigator.clipboard.writeText(what === "body" ? draft.body : draft.reply);
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <article
      className={`rounded-2xl border border-border bg-surface p-4 transition-all duration-200 ease-out ${
        posted ? "opacity-40" : ""
      }`}
    >
      <header className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wide">
        <span className={SOURCE_TONE[item.source]}>{SOURCE_NAME[item.source]}</span>
        <span className="text-text-low">·</span>
        <span className="text-text-muted">{item.kind}</span>
        <span className="text-text-low">·</span>
        <span className="text-text-muted">{age(item.publishedAt)}</span>
        <span className="ml-auto rounded-md bg-surface-elevated px-2 py-0.5 text-text-muted">
          {item.score}
        </span>
      </header>

      {item.scooped && (
        <p className="mb-3 rounded-md border border-coral/40 px-3 py-2 text-sm text-coral">
          {item.scooped} already posted this — you are not first.
        </p>
      )}

      <pre className="whitespace-pre-wrap break-words font-sans text-base text-text">
        {draft.body}
      </pre>

      <p className="mt-2 text-xs text-text-low">
        {postLength(draft.body)} chars
        {/* Once the list is in, the "needs the list" note is stale and reads as a warning
            about a post that has already been fixed. */}
        {(() => {
          const shown = resolved
            ? item.reasons.filter((reason) => !reason.includes("needs the"))
            : item.reasons;
          return shown.length > 0 ? ` · ${shown.join(" · ")}` : null;
        })()}
      </p>

      {/* Reply 1 is part of the post, not an afterthought: the link lives here because it
          would cost reach in the body. Showing it as a block makes that the obvious flow
          rather than something to remember. */}
      <div className="mt-3 rounded-xl border border-dashed border-border p-3">
        <p className="mb-1 text-xs uppercase tracking-wide text-text-low">
          Reply 1 — post this as a comment
        </p>
        <pre className="whitespace-pre-wrap break-all font-sans text-sm text-text-muted">
          {draft.reply}
        </pre>
      </div>

      {(draft.image || draft.secondImage) && (
        <div className={`mt-3 grid gap-2 ${draft.secondImage && draft.image ? "grid-cols-2" : "grid-cols-1"}`}>
          {[draft.image, draft.secondImage].filter(Boolean).map((src) => (
            // Loaded straight from the source. HLTV's image CDN answers a browser and
            // refuses a server, so routing these through /api/image blanked every player
            // photo in the feed — the proxy exists for the canvas, not for display.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt=""
              className="w-full rounded-xl border border-border"
              loading="lazy"
            />
          ))}
        </div>
      )}

      {draft.secondImage && (
        <p className="mt-2 text-xs text-text-low">
          Two images: the news, then the game. Attach both.
        </p>
      )}

      {extraImages.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-text-low">
            From the article — attach these too
          </p>
          <div className={`grid gap-2 ${extraImages.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {extraImages.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt=""
                className="w-full rounded-xl border border-border"
                loading="lazy"
              />
            ))}
          </div>
        </div>
      )}

      {needsTranslation && !translated && (
        <button
          onClick={translate}
          disabled={translating}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-teal px-3 text-sm text-teal transition-colors duration-150 ease-out disabled:opacity-50"
        >
          <IconLanguage size={18} stroke={1.5} />
          {translating ? "Translating…" : "Russian — translate to English"}
        </button>
      )}

      {translateError && (
        <p className="mt-2 text-xs text-coral">
          {translateError} — post the original or translate it yourself.
        </p>
      )}

      {blocked && (
        <button
          onClick={loadDetail}
          disabled={loadingDetail}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-amber px-3 text-sm text-amber transition-colors duration-150 ease-out disabled:opacity-50"
        >
          <IconListDetails size={18} stroke={1.5} />
          {loadingDetail ? "Loading the detail…" : "Missing the specifics — get them"}
        </button>
      )}

      {!hasMedia && (
        <p className="mt-3 text-sm text-coral">
          No image yet. Posts without one get scrolled past — make the card first.
        </p>
      )}

      {detail !== null && !resolved && (
        <p className="mt-3 text-sm text-text-muted">
          Nothing found in the article — open it and check before posting.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => copy("body")}
          disabled={blocked}
          className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-amber font-medium text-black transition-colors duration-150 ease-out disabled:opacity-40"
        >
          {copied === "body" ? <IconCheck size={18} stroke={1.5} /> : <IconCopy size={18} stroke={1.5} />}
          {copied === "body" ? "Copied" : "Copy post"}
        </button>
        <button
          onClick={() => copy("reply")}
          className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-border text-text-muted transition-colors duration-150 ease-out hover:text-text"
        >
          {copied === "reply" ? <IconCheck size={18} stroke={1.5} /> : <IconCopy size={18} stroke={1.5} />}
          {copied === "reply" ? "Copied" : "Copy reply 1"}
        </button>
        <button
          onClick={onMakeCard}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-md border text-sm transition-colors duration-150 ease-out ${
            !hasMedia
              ? "border-coral text-coral"
              : draft.needsCard
                ? "border-purple text-purple"
                : "border-border text-text-muted hover:text-text"
          }`}
        >
          <IconPhotoPlus size={18} stroke={1.5} />
          {!hasMedia ? "No image — make one" : draft.needsCard ? "Make card" : "Make card"}
        </button>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-border text-sm text-text-muted transition-colors duration-150 ease-out hover:text-text"
        >
          <IconExternalLink size={18} stroke={1.5} />
          Verify
        </a>
      </div>

      <button
        onClick={onTogglePosted}
        className="mt-2 min-h-11 w-full rounded-md text-sm text-text-low transition-colors duration-150 ease-out hover:text-text-muted"
      >
        {posted ? "Mark unposted" : "Mark posted"}
      </button>

      <p className="sr-only">Posting as {handle}</p>
    </article>
  );
}
