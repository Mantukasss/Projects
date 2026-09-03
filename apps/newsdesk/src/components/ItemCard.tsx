"use client";

import { useState } from "react";
import {
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconPhotoPlus,
} from "@tabler/icons-react";
import type { FeedItem } from "@/lib/types";
import { SOURCE_NAME, compose, postLength } from "@/lib/compose";

const SOURCE_TONE: Record<FeedItem["source"], string> = {
  hltv: "text-amber",
  liquipedia: "text-purple",
  reddit: "text-coral",
  steam: "text-blue",
  vlr: "text-teal",
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
  onMakeCard,
}: {
  item: FeedItem;
  handle: string;
  posted: boolean;
  onTogglePosted: () => void;
  onMakeCard: () => void;
}) {
  const draft = compose(item);
  const [copied, setCopied] = useState<"body" | "reply" | null>(null);

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

      <pre className="whitespace-pre-wrap break-words font-sans text-base text-text">
        {draft.body}
      </pre>

      <p className="mt-2 text-xs text-text-low">
        {postLength(draft.body)} chars
        {item.reasons.length > 0 && ` · ${item.reasons.join(" · ")}`}
      </p>

      {draft.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={draft.image}
          alt=""
          className="mt-3 w-full rounded-xl border border-border"
          loading="lazy"
        />
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => copy("body")}
          className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-amber font-medium text-black transition-colors duration-150 ease-out"
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
            draft.needsCard
              ? "border-purple text-purple"
              : "border-border text-text-muted hover:text-text"
          }`}
        >
          <IconPhotoPlus size={18} stroke={1.5} />
          {draft.needsCard ? "Card needed" : "Make card"}
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
