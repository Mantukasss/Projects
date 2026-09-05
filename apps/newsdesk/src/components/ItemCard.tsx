"use client";

import { useState } from "react";
import {
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconLanguage,
  IconListDetails,
  IconPencil,
  IconPhotoPlus,
} from "@tabler/icons-react";
import type { FeedItem } from "@/lib/types";
import {
  SOURCE_NAME,
  compose,
  composeFromWriteup,
  composeWithDetail,
  planMedia,
  postLength,
  type Writeup,
} from "@/lib/compose";
import CrestTile from "./CrestTile";
import PostImages from "./PostImages";
import ResultCard from "./ResultCard";
import { parseResult } from "@/lib/results";

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
  onMakeCard: (item: FeedItem) => void;
}) {
  const [detail, setDetail] = useState<{ teams: string[]; keyFact: string | null; images: string[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [copied, setCopied] = useState<"body" | "reply" | null>(null);
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  /**
   * Options whose image failed to load, and a nonce to retry them with.
   *
   * Every option is a guess that can miss — a nickname with no wiki page, a crest behind
   * Liquipedia's rate limiter, a CDN having a moment. These are NOT hidden: a labelled
   * "did not load, tap to retry" tile tells you the option exists and that the miss is
   * probably temporary, where a vanishing tile just looks like the app found nothing.
   * Most of these misses are the rate limiter, so a retry usually works.
   */
  const [deadImages, setDeadImages] = useState<string[]>([]);
  const [writeup, setWriteup] = useState<Writeup | null>(null);
  const [showScoreboard, setShowScoreboard] = useState(false);

  /**
   * A result we can draw ourselves. Only when both teams resolve to crests we hold — a
   * scoreboard naming the wrong side is worse than no scoreboard.
   */
  const matchResult = parseResult(item.title);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  /**
   * Turns a headline into the three-part post the incumbents write.
   *
   * HLTV articles are fetched first so the summary is written from the story rather than
   * from its headline — a lead that says what a quote MEANS cannot be derived from the
   * quote alone, and that is the whole difference between the two formats.
   */
  const writeItUp = async (forItem: FeedItem) => {
    setWriting(true);
    setWriteError(null);
    try {
      let paragraphs: string[] = [];
      if (forItem.source === "hltv") {
        const detailRes = await fetch(`/api/detail?url=${encodeURIComponent(forItem.url)}`);
        if (detailRes.ok) {
          const data = await detailRes.json();
          if (Array.isArray(data.paragraphs)) paragraphs = data.paragraphs;
        }
      }
      const res = await fetch("/api/writeup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: forItem.title, summary: forItem.summary, paragraphs }),
      });
      const data = await res.json();
      if (res.ok && data.lead) setWriteup(data as Writeup);
      else setWriteError(data.error ?? "write-up failed");
    } catch {
      setWriteError("write-up failed");
    } finally {
      setWriting(false);
    }
  };
  const [retryNonce, setRetryNonce] = useState(0);

  const retryImages = () => {
    setDeadImages([]);
    setRetryNonce((n) => n + 1);
  };

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
  const written = writeup
    ? composeFromWriteup(source, writeup)
    : detail
      ? composeWithDetail(source, detail)
      : compose(source);

  /**
   * Words from the translated item, pictures from the original.
   *
   * Translating a post does not translate the text burned into its screenshot, but planning
   * media from the translated item made it look as though it had: the Russian caution
   * disappeared and the English card stopped being offered, on a post whose picture was
   * still entirely in Russian.
   */
  const media = planMedia(item, writeup?.people ?? []);
  const draft = { ...written, images: media.options, needsCard: media.needsCard };

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
  // Two images, never fewer. One picture reads as a caption; a pair reads as an event, and
  // that is the difference between a post that gets looked at and one that gets scrolled.
  // Every option stays on screen; only the ones that actually loaded are counted as ready.
  const loadedCount = draft.images.filter((option) => !deadImages.includes(option.url)).length;
  const attachmentCount = loadedCount + extraImages.length + (cardMade ? 1 : 0);
  const hasMedia = attachmentCount >= 2;

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

      {/* The matched pair leads, because it is what the post should actually go out with.
          Everything below it is an alternative, not the default. */}
      <PostImages
        person={writeup?.people?.[0] ?? item.playerName ?? null}
        teamPage={item.teamPage ?? null}
        wiki={item.source === "vlr" ? "valorant" : "counterstrike"}
      />

      {draft.images.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-text-low">
            Other options
            {deadImages.length > 0 && (
              <button
                onClick={retryImages}
                className="rounded-md border border-border px-2 py-0.5 normal-case tracking-normal text-amber"
              >
                Retry {deadImages.length}
              </button>
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {draft.images.map((option) =>
              option.crest && !deadImages.includes(option.url) ? (
                <CrestTile
                  key={option.url}
                  logoUrl={option.url}
                  brand={option.crest.brand}
                  label={option.label}
                  onFailed={() =>
                    setDeadImages((current) =>
                      current.includes(option.url) ? current : [...current, option.url],
                    )
                  }
                />
              ) : (
              <a
                key={option.url}
                href={option.url}
                target="_blank"
                rel="noreferrer noopener"
                className="block overflow-hidden rounded-xl border border-border transition-colors duration-150 ease-out hover:border-border-focus"
              >
                {/* Loaded straight from the source. HLTV's image CDN answers a browser and
                    refuses a server, so routing these through /api/image blanked every
                    player photo — the proxy exists for the canvas, not for display. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {option.video ? (
                  // Muted, looping and inline so a clip previews without taking over the
                  // feed; the link still opens the file itself to save.
                  <video
                    src={option.url}
                    className="h-28 w-full bg-surface-elevated object-contain"
                    muted
                    loop
                    playsInline
                    autoPlay
                  />
                ) : deadImages.includes(option.url) ? (
                  <span className="flex h-28 w-full items-center justify-center bg-surface-elevated px-2 text-center text-[11px] text-text-low">
                    Did not load — tap Retry
                  </span>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={retryNonce ? `${option.url}${option.url.includes("?") ? "&" : "?"}r=${retryNonce}` : option.url}
                    alt={option.label}
                    className="h-28 w-full bg-surface-elevated object-contain"
                    loading="lazy"
                    onError={() =>
                      setDeadImages((current) =>
                        current.includes(option.url) ? current : [...current, option.url],
                      )
                    }
                  />
                )}
                <span className="block px-2 py-1 text-[11px] text-text-muted">
                  {option.video && <span className="mr-1 text-teal">▶</span>}
                  {option.label}
                  {option.caution && (
                    <span className="block text-amber">{option.caution}</span>
                  )}
                </span>
              </a>
              ),
            )}
          </div>
        </div>
      )}

      <p className="mt-2 text-xs text-text-low">
        {attachmentCount >= 2
          ? `${attachmentCount} images ready — attach two.`
          : needsTranslation
            ? "The source picture carries Russian text. Build the English image, or pick another below."
            : draft.needsCard
              ? "No picture of its own. Build the image — it draws the quote over the player's photo."
              : "One image. Build a second so the post reads as an event, not a caption."}
      </p>

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

      {translated && (
        <p className="mt-2 rounded-md border border-amber/40 px-3 py-2 text-xs text-amber">
          Check every name against the source before posting. Nicknames are stylised and a
          translator cannot derive them — this one knows the common ones and leaves the rest
          in Cyrillic rather than guessing.
        </p>
      )}

      {translateError && (
        <p className="mt-2 text-xs text-coral">
          {translateError} — post the original or translate it yourself.
        </p>
      )}

      {/* Only an item whose headline actually promised specifics has anything to fetch —
          and only HLTV articles can be read. Showing this on a post blocked merely for
          lacking a second image offered a fix that could not work. */}
      {item.incomplete && detail === null && (
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
          {needsTranslation
            ? "The source picture is Russian text your audience cannot read, so it is not attached. Make the English card."
            : "Needs two images. One reads as a caption; two read as an event."}
        </p>
      )}

      {detail !== null && !resolved && (
        <p className="mt-3 text-sm text-text-muted">
          Nothing found in the article — open it and check before posting.
        </p>
      )}

      {matchResult && (
        <button
          onClick={() => setShowScoreboard(true)}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-green px-3 text-sm text-green transition-colors duration-150 ease-out"
        >
          <IconPhotoPlus size={18} stroke={1.5} />
          Build scoreboard — {matchResult.winner} vs {matchResult.loser}
        </button>
      )}

      {showScoreboard && matchResult && (
        <ResultCard
          result={matchResult}
          handle={handle}
          onClose={() => setShowScoreboard(false)}
        />
      )}

      <button
        onClick={() => writeItUp(source)}
        disabled={writing}
        className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-blue px-3 text-sm text-blue transition-colors duration-150 ease-out disabled:opacity-50"
      >
        <IconPencil size={18} stroke={1.5} />
        {writing ? "Writing…" : writeup ? "Rewrite it" : "Write it up"}
      </button>

      {writeError && (
        <p className="mt-2 text-xs text-coral">{writeError}</p>
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
          onClick={() => onMakeCard(source)}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-md border text-sm transition-colors duration-150 ease-out ${
            cardMade
              ? "border-green text-green"
              : draft.needsCard
                ? "border-coral text-coral"
                : "border-border text-text-muted hover:text-text"
          }`}
        >
          <IconPhotoPlus size={18} stroke={1.5} />
          {cardMade
            ? "Image ready"
            : draft.needsCard
              ? needsTranslation
                ? "Build English image"
                : "Build image"
              : "Extra image"}
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
