# Newsdesk — app context (`apps/newsdesk`)

> Read the repo-root `CLAUDE.md` and `SCHEMA_RULES.md` first — they govern every app.
> **Keep `Current state` and `Next` (bottom) up to date — update them after every change.**

A posting console for a CS2 esports news account on X. Aggregates the sources that break
Counter-Strike news, ranks them by how much posting them right now is worth, and emits a
ready-to-post draft plus media.

## Stack
- Next.js 15 (App Router) + React 19 + TypeScript, `src/` layout, legacy ESLint
- Tailwind 3 + Radix Colors (dark only), Tabler icons, `fast-xml-parser` for RSS/Atom
- **No Supabase, no auth, no cron.** Deliberate — see Gotchas.
- Prod: Vercel project `mantas-newsdesk`, Root Directory `apps/newsdesk`

## Conventions
- One file per source under `src/lib/sources/`, each exporting `fetch<Source>(): Promise<FeedItem[]>`.
  Add a source by writing that function and registering it in `src/app/api/feed/route.ts`.
- All outbound fetches go through `src/lib/sources/fetchXml.ts` so every request carries the
  descriptive User-Agent that Liquipedia's terms require.
- `src/lib/compose.ts` owns the post format and is the one place posting strategy lives.
  Every rule in it has a comment saying which account or platform behaviour it came from.
  **Change the strategy there, not in components.**
- `src/lib/score.ts` owns ranking. Scores must stay explainable: anything that moves a score
  pushes a human-readable string into `reasons`, which the card renders.
- Per-device state (posted list, handle, source toggles) is `localStorage`, always read and
  written through the `readStored`/`writeStored` helpers that swallow private-mode throws.

## Data model
None. There is no database and no user data — nothing to apply `SCHEMA_RULES.md` to yet.
If a "posted" history needs to survive across devices it becomes `newsdesk.posted_items`
`(user_id, item_id, posted_at)` in the shared Supabase project, with RLS on `user_id`,
and the app gains Google sign-in copied from `apps/hub`.

## Gotchas
- **The palette needs `className="dark"` on `<html>`.** Radix Colors v3 scopes its dark
  scales to `.dark, .dark-theme`, not `:root`. Without the class every `--mauve-*` token is
  undefined and the page silently falls back to browser defaults — it looks plausible and is
  entirely unstyled. This bit `apps/hub` too and was fixed there in the same commit.
- **Liquipedia caps `action=query` at one request per 30 seconds per IP** and answers 429
  past it. The feed makes exactly one Liquipedia call, caches it 90s, and wraps it in
  `staleOnError` so a 429 serves the previous result rather than an empty section. Do not
  add a second Liquipedia call without merging it into the existing one.
- **Liquipedia edit comments are usually empty.** Filtering on a roster keyword in the
  comment matched 0 of 200 live changes; filtering on page *shape* (short title, no
  tournament words, no year, no slash) matched 20, and they were the right 20. The comment
  is a ranking bonus only. Do not "fix" this by requiring the keyword again.
- **A burst is one story.** Several pages edited in one window get collapsed into a single
  item. Emitting one card per page produced ten posts about one roster shuffle.
- **Reddit 429s from any datacenter IP** regardless of User-Agent — verified. It needs a
  free Reddit OAuth app, so it is off by default.
- **Vercel Hobby caps cron at once per day**, which is why this app is pull-based: it
  fetches when you open it. Push notifications would need Supabase `pg_cron` + `pg_net`
  (free, runs in-database, minute-level), not Vercel cron.
- No source image means the quote card is the media. `needsCard` on the draft flags it and
  the card button turns purple.

## Current state
Working and verified against live data, not yet deployed. `npm run build` and `tsc --noEmit`
both pass. A live run returned 13 ranked items with no source errors: three collapsed
Liquipedia roster bursts (top scorer was Imperial Esports + AdeX + Levi edited inside 20
minutes) and ten HLTV items with images and correct quote/roster/result classification.
The quote-card generator, both copy buttons, source toggles and the posted list all work;
screenshots were taken at a 412px viewport.

Vercel project `mantas-newsdesk` exists (Root Directory `apps/newsdesk`, production branch
`main`) and is registered in `apps/hub/config/apps.json` at
`https://mantas-newsdesk.vercel.app`. Unlike the hub, this app's `vercel.json` does **not**
set `git.deploymentEnabled: false` — the template ships that flag on, which silently blocks
every git-triggered build, so it was removed here to let pushes deploy.

## Next
- Deploy: run `node apps/hub/scripts/setup-vercel-project.mjs --repo projects --name mantas-newsdesk --slug newsdesk`, then fix the real URL in `apps/hub/config/apps.json`.
- Add the streamer layer: Twitch Helix for live/offline transitions and clip-view velocity, which finds a viral moment before it is viral on X. Needs a free Twitch app (client id + secret).
- Add a Polymarket detector: `https://data-api.polymarket.com` is public and unauthenticated, so large position opens by top-ranked wallets are free to compute and nobody is posting them in a clean format.
- Push instead of pull, once the feed proves itself: Supabase `pg_cron` + `pg_net` on a one-minute schedule, writing new items to a table and firing a web push.
