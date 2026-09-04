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
- **Reddit's rate limiting is per-IP, so it depends who is asking.** It refuses this repo's
  build sandbox (whose egress policy blocks it outright) and answers Vercel's runtime. An
  earlier note here claimed all datacenter ranges were blocked; that was wrong.
- **The XML parser caps entity expansion at 1000 by default** to blunt "billion laughs"
  bombs. Reddit escapes each post's full HTML into its Atom `<content>` and runs past 1200,
  which failed the whole source with "Entity expansion limit exceeded: 1250 > 1000". The cap
  is raised, not removed, in `fetchXml.ts`.
- **Team badges are fetched on demand, never with the feed.** Each costs one Liquipedia
  `parse` request that cannot be batched; resolving every team on every refresh, in
  parallel, tripped the rate limiter and returned 429 for all of them. `/api/logo` resolves
  one team when you open its card. Misses cache for 5 minutes, not a day — caching a
  transient 429 for 24h blanks every badge until tomorrow.
- **Logos come from the infobox, not `prop=images`.** The batched route returns a team
  page's whole image list, which includes every opponent from its match tables, so MOUZ
  resolved to "4klogo" and Imperial Esports to "Red Canids". Only section 0 gives the team's
  own badge. `prop=pageimages` returns nothing — the extension is not populated here.
- **Never attach a bare team crest as a post image.** They are transparent PNGs drawn for a
  white wiki page — some dark, some wordmarks, some thin line art — and posted raw they read
  as a missing asset. `QuoteCard` sets them on a consistent rounded plate instead, which is
  what makes a run of posts look like one publication rather than a scrape.
- **The image often IS the news.** A Reddit item like "Glock-18 | Floating Camo" is a skin
  concept; posting that headline beside a generic game capsule is worse than not posting it.
  `reddit.ts` pulls the full-size image from the entry content, preferring i.redd.it and
  preview.redd.it links over the tiny media:thumbnail.
- **A post never carries a picture of Russian text.** The audience cannot read it, so
  `planMedia` drops a foreign-script item's screenshot and the generated English card takes
  its place; `QuoteCard` refuses to bake one in for the same reason. Do not "fix" this by
  attaching the original.
- **The card is built from the translated item, not the row's original.** `onMakeCard`
  hands back the effective source, or an English card would come out carrying Russian.
- **Groq's model is discovered at runtime, never hardcoded.** A hardcoded, plausible-looking
  name was not in Groq's lineup and every call failed. `/api/translate` asks Groq what it
  serves and prefers the smallest capable chat model.
- **The translator is given CS vocabulary explicitly.** A literal "снайпер" becomes "sniper",
  which no CS account would write — it is "AWPer" — and one word like that gives the post
  away as machine-made.
- **An env-var change alone cannot be deployed in this repo.** Redeploying the same commit
  makes `scripts/vercel-ignore.sh` compare it against itself, find no diff, exit 0, and
  Vercel CANCELS the build — the new variable never reaches the runtime. Push a real commit
  instead. This cost a confused half-hour once; it will again.
- **HLTV article images come in two kinds.** `/gallerypicture/` is editorial — the graphic
  listing who qualified, the trophy shot — and worth attaching to a post. `/teamlogo/` is a
  100px inline icon and is not media. `/api/detail` returns only the first kind.
- **HLTV's image CDN answers a browser and refuses a server.** Its photos must be rendered
  from the source URL directly; routing them through `/api/image` returns 502 and blanks
  every player photo in the feed. The proxy exists for the canvas, not for display.
  Consequence: a source photo drawn onto the quote card taints it, so `download()` catches
  the throw, drops the photo and redraws.
- **`teams.ts` is a curated list and `/api/logo` trusts it.** The shape heuristic that keeps
  player pages out also rejects real orgs carrying no giveaway word — "The MongolZ",
  "Astralis", "Fnatic" — and silently dropped their badges.
- **Never resolve a badge for a player page.** A player's infobox shows their *current*
  team, which on a transfer story is the club they may be leaving. `/api/logo` 404s on them.
- **`/api/image` is allowlisted on purpose.** An open image proxy lets anyone use the
  deployment to fetch arbitrary URLs, including private addresses on the host network.
- **Vercel Hobby caps cron at once per day**, which is why this app is pull-based: it
  fetches when you open it. Push notifications would need Supabase `pg_cron` + `pg_net`
  (free, runs in-database, minute-level), not Vercel cron.
- No source image means the quote card is the media. `needsCard` on the draft flags it and
  the card button turns purple.
- **Telegram is read through `t.me/s/<channel>`** — plain HTML, no API, no key, any public
  channel's last ~20 posts. `cstracker` reports Valve build changes detected from Steam
  depots, which lands before any announcement; `newcsgo` breaks CIS roster news ahead of
  English outlets. Both are Russian and arrive untranslated.
- **`rivals.ts` is not a content source.** It reads what the incumbents already posted so
  the feed can say "you are not first". Its matcher is deliberately strict — a false
  positive hides a real scoop, which costs far more than an occasional duplicate.
- **Two heuristics here have already been wrong in instructive ways.** `incomplete.ts` once
  matched a bare "results" and flagged the quote `zont1x: "...significant results..."`; and
  its "already carries specifics" test accepted anything scoreline-shaped, which swallowed
  "will run from September 9-13" and let the emptiest post through. Dates look like scores.
  Prefer requiring the announcing verb and comma-separated proper nouns over clever
  shortcuts.
- **Team names come from HLTV's anchor text, not the URL slug.** Rebuilding from the slug
  gave "Mouz", "9Z" and "THE Mongolz" instead of "MOUZ", "9z" and "The MongolZ".

### Ordering
Newest first by default; `?sort=score` returns the ranked order and the UI toggles it.
Score decides what is worth posting, time decides what is new, and ranking by score buries
the thing that just landed behind something better from three hours ago.

### Media
Every post carries an image; the card blocks copying until one exists. An item that names a
known team gets that team's Liquipedia badge, whatever the source, so a roster story goes
out wearing the right crest. Game updates carry two images — the news and the game — which
is how the accounts that own this beat post them.

### Post format
Posts open `JUST IN:` or `RUMOR:` and credit no source in the text. Both come from reading
what the incumbent actually publishes: the label tells a reader in two words how much to
trust the line, and it makes being wrong survivable — a rumour that does not pan out costs
nothing if it went out labelled a rumour. Attribution lives in the media and in reply 1,
never in the body.

## Current state
**Live at https://mantas-newsdesk.vercel.app** and verified there: the deployed `/api/feed`
returns 13 ranked items with no source errors, so both HLTV and Liquipedia answer Vercel's
datacenter IPs — the open risk before deploying, since Liquipedia rate-limits by IP.

Note that this production deployment is serving the **feature branch**, not `main`. Vercel
promotes a project's first deployment to production regardless of branch; every later
feature-branch push will be a preview, and `main` takes over once merged.

Working and verified against live data. `npm run build` and `tsc --noEmit`
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
- Translate and classify the Russian Telegram posts. Needs a free `GROQ_API_KEY` or `GEMINI_API_KEY` added to the Vercel project — neither is set today, which is why `looksLikeNews` is a regex rather than comprehension.
- Add the streamer layer: Twitch Helix for live/offline transitions and clip-view velocity, which finds a viral moment before it is viral on X. Needs a free Twitch app (client id + secret).
- Add a Polymarket detector: `https://data-api.polymarket.com` is public and unauthenticated, so large position opens by top-ranked wallets are free to compute and nobody is posting them in a clean format.
- Push instead of pull, once the feed proves itself: Supabase `pg_cron` + `pg_net` on a one-minute schedule, writing new items to a table and firing a web push.
