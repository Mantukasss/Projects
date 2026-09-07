"use client";

import { useState } from "react";
import {
  IconCheck,
  IconBrandX,
  IconCopy,
  IconExternalLink,
  IconLanguage,
  IconListDetails,
  IconPencil,
  IconPhotoPlus,
  IconQuote,
  IconShare,
} from "@tabler/icons-react";
import type { FeedItem } from "@/lib/types";
import {
  SOURCE_NAME,
  compose,
  composeFromWriteup,
  composeWithDetail,
  planMedia,
  postLength,
  LEAD_EMOJI,
  setLeadEmoji,
  type Writeup,
} from "@/lib/compose";
import CrestTile from "./CrestTile";
import PostImages from "./PostImages";
import ResultCard from "./ResultCard";
import { parseResult } from "@/lib/results";
import { objectSearchLinks } from "@/lib/photoSearch";
import { needsTranslation as isForeignLanguage } from "@/lib/language";

const SOURCE_TONE: Record<FeedItem["source"], string> = {
  hltv: "text-amber",
  liquipedia: "text-purple",
  reddit: "text-coral",
  steam: "text-blue",
  telegram: "text-teal",
  twitch: "text-purple",
  youtube: "text-coral",
  x: "text-text",
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
  onTogglePosted,
}: {
  item: FeedItem;
  handle: string;
  posted: boolean;
  onTogglePosted: () => void;
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

  interface PulledQuote {
    text: string;
    speaker: string | null;
    about: string;
    confidence: string;
  }
  const [quotes, setQuotes] = useState<PulledQuote[] | null>(null);
  const [pulling, setPulling] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  /**
   * Reads the interview and returns the lines worth posting.
   *
   * Only for YouTube items, because it needs captions. Auto-generated captions have no
   * speaker labels and mishear names, so quotes arrive with a confidence flag and a link
   * back to the video — they are leads to check, not copy ready to publish.
   */
  const pullQuotes = async () => {
    setPulling(true);
    setQuoteError(null);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.quotes)) setQuotes(data.quotes);
      else setQuoteError(data.error ?? "could not read this interview");
    } catch {
      setQuoteError("could not read this interview");
    } finally {
      setPulling(false);
    }
  };
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
  const [leadEmoji, chooseLeadEmoji] = useState<string | null>(null);

  const retryImages = () => {
    setDeadImages([]);
    setRetryNonce((n) => n + 1);
  };

  // Not English means it cannot go out as written. See lib/language.ts for how that is
  // judged — a Portuguese post from FURIA reads as English to any alphabet-based test.
  const needsTranslation = isForeignLanguage(`${item.title} ${item.summary}`);

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
  // the bare headline. A translated post replaces the headline entirely — the original
  // language is never what goes out.
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
   * media from the translated item made it look as though it had: the foreign-text caution
   * disappeared the moment the words were translated, on a post whose picture still carried
   * the original language burned into it.
   */
  const media = planMedia(item, writeup?.people ?? []);

  /**
   * The emoji closing the lead line, when you have overruled the draft.
   *
   * A tap rather than a setting, because it is a judgement about THIS story and the model is
   * measurably bad at it — asked to write up a retirement it returned a trophy, live, with
   * the prompt naming that exact mistake. The prompt now errs towards none, which is right
   * four posts in five for cs2files but wrong for Ozzny, who closes every lead with one. One
   * tap settles it, and a person reading the draft is never wrong about the tone.
   */
  const body = leadEmoji === null ? written.body : setLeadEmoji(written.body, leadEmoji);
  const draft = { ...written, body, images: media.options, needsCard: media.needsCard };

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
  const attachmentCount = loadedCount + extraImages.length;
  const hasMedia = attachmentCount >= 2;

  const blocked =
    (Boolean(item.incomplete) && detail === null) || (needsTranslation && !translated);

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

  /**
   * The two finished squares, as files, handed up by PostImages.
   *
   * Held here rather than there because the share needs the words and the pictures in the
   * same call, and the words live on this card.
   */
  const [images, setImages] = useState<File[]>([]);

  /**
   * Text AND both pictures into X, in one tap.
   *
   * This is the whole flow — save two images, switch app, find them in the camera roll,
   * attach, paste — collapsed into a single system share sheet. `navigator.share` with
   * files is what makes it possible; X's share target accepts text plus images.
   *
   * Guarded on `canShare` because it is a mobile capability: desktop browsers mostly refuse
   * files, and Firefox refuses outright. Where it is missing the card simply does not offer
   * the button and the Open in X route below still works. A cancelled sheet throws
   * AbortError, which is a user saying no, not a failure to report.
   */
  const shareable =
    images.length > 0 &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.canShare?.({ files: images, text: draft.body }));

  const shareToX = async () => {
    try {
      await navigator.share({ text: draft.body, files: images });
    } catch {
      // Cancelled, or the target refused it. The buttons below are still there.
    }
  };

  /**
   * Opens X's composer with the post already in it.
   *
   * `x.com/intent/post?text=` is a public URL, no key and no API: verified live, and on iOS
   * it redirects to `x-safari-https://` which hands off to the X app rather than the
   * browser. So the whole flow becomes save the two pictures, tap this, attach, post —
   * instead of copy, switch app, find the composer, paste.
   *
   * The clipboard is still filled first. The intent URL cannot carry an attachment, and it
   * is one X change away from breaking; a post already on the clipboard means the tap is
   * never a dead end.
   */
  const openComposer = async () => {
    await navigator.clipboard.writeText(draft.body).catch(() => undefined);
    setCopied("body");
    setTimeout(() => setCopied(null), 1600);
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(draft.body)}`,
      "_blank",
      "noopener,noreferrer",
    );
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

      {/* The tone of the first line, in one tap. See leadEmoji above for why this is not
          left to the model. */}
      <div className="mt-2 flex flex-wrap gap-1">
        {LEAD_EMOJI.map((option) => {
          const active = leadEmoji === option.emoji;
          return (
            <button
              key={option.label}
              onClick={() => chooseLeadEmoji(active ? null : option.emoji)}
              title={option.label}
              className={`min-h-8 rounded-md border px-2 py-1 text-sm transition-colors duration-150 ease-out ${
                active ? "border-amber text-amber" : "border-border text-text-low hover:text-text-muted"
              }`}
            >
              {option.emoji || <span className="text-xs">no emoji</span>}
            </button>
          );
        })}
      </div>

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
      {/* The write-up names everyone in the story, speaker first, so a quote about two
          people can go out wearing both their faces — which is the pair both studied
          accounts reach for first. The crest is what fills the slot when there is only one. */}
      <PostImages
        person={writeup?.people?.[0] ?? item.playerName ?? null}
        second={writeup?.people?.[1] ?? null}
        teamPage={item.teamPage ?? null}
        handle={handle}
        onReady={setImages}
        wiki={item.source === "vlr" ? "valorant" : "counterstrike"}
      />

      {/* The other half of the pair, when the quote is about a THING rather than a person.
          Links rather than an automatic fetch: this picture carries the punchline, and a
          badly chosen one is worse than none. See objectSearchLinks. */}
      {writeup?.object && (
        <div className="mt-2 rounded-md border border-dashed border-border p-2">
          <p className="mb-1 text-xs text-text-muted">
            This one is about <span className="text-text">{writeup.object}</span> — a picture
            of it beside the face is the pair that works:
          </p>
          <div className="flex flex-wrap gap-2">
            {objectSearchLinks(writeup.object).map((link) => (
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
      )}

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
            ? "The source picture carries text your audience cannot read. Pick another below."
              : draft.needsCard
                ? "No picture of its own — attach a player photo and the team crest."
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
          {translating ? "Translating…" : "Not English — translate it"}
        </button>
      )}

      {translated && (
        <p className="mt-2 rounded-md border border-amber/40 px-3 py-2 text-xs text-amber">
          Check every name against the source before posting. Nicknames are stylised and a
          translator cannot derive them — this one knows the common ones and leaves the rest
          in the original spelling rather than guessing.
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
            ? "Translate it first, then attach two pictures — this cannot go out as written."
            : "Needs two images. One reads as a caption; two read as an event."}
        </p>
      )}

      {detail !== null && !resolved && (
        <p className="mt-3 text-sm text-text-muted">
          Nothing found in the article — open it and check before posting.
        </p>
      )}

      {item.source === "youtube" && (
        <button
          onClick={pullQuotes}
          disabled={pulling}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-teal px-3 text-sm text-teal transition-colors duration-150 ease-out disabled:opacity-50"
        >
          <IconQuote size={18} stroke={1.5} />
          {pulling ? "Reading the interview…" : quotes ? "Read it again" : "Pull quotes from this interview"}
        </button>
      )}

      {quoteError && <p className="mt-2 text-xs text-coral">{quoteError}</p>}

      {quotes && (
        <div className="mt-3 space-y-2">
          <p className="text-xs uppercase tracking-wide text-text-low">
            {quotes.length} quotes — check each against the video before posting
          </p>
          {quotes.map((quote) => (
            <div key={quote.text} className="rounded-xl border border-border bg-surface-elevated p-3">
              <p className="text-sm text-text">&ldquo;{quote.text}&rdquo;</p>
              <p className="mt-1 text-xs text-text-low">
                {quote.speaker ? `— ${quote.speaker}` : "speaker not named in the captions"}
                {quote.about && ` · ${quote.about}`}
                {quote.confidence === "low" && (
                  <span className="text-amber"> · verify the wording</span>
                )}
              </p>
              <button
                onClick={() =>
                  navigator.clipboard.writeText(
                    `\u201C${quote.text}\u201D${quote.speaker ? ` — ${quote.speaker}` : ""}`,
                  )
                }
                className="mt-2 min-h-11 w-full rounded-md border border-border text-xs text-text-muted"
              >
                Copy this quote
              </button>
            </div>
          ))}
        </div>
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

      {/* One tap to publish: the text goes to the clipboard AND to X's composer. Everything
          else on this row is a fallback for when that is not what you want. */}
      {shareable && (
        <button
          onClick={shareToX}
          disabled={blocked}
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-amber font-medium text-black transition-colors duration-150 ease-out disabled:opacity-40"
        >
          <IconShare size={18} stroke={1.5} />
          {blocked
            ? "Fix the post first"
            : `Share to X — text + ${images.length} image${images.length > 1 ? "s" : ""}`}
        </button>
      )}

      <button
        onClick={openComposer}
        disabled={blocked}
        className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-md transition-colors duration-150 ease-out disabled:opacity-40 ${
          shareable
            ? "mt-2 border border-border text-sm text-text-muted hover:text-text"
            : "mt-4 bg-amber font-medium text-black"
        }`}
      >
        <IconBrandX size={18} stroke={1.5} />
        {blocked ? "Fix the post first" : shareable ? "Open in X — text only" : "Open in X — text ready"}
      </button>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => copy("body")}
          disabled={blocked}
          className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-border text-text-muted transition-colors duration-150 ease-out hover:text-text disabled:opacity-40"
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
