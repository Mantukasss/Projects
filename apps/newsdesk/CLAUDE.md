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
- **Reddit's preview URLs are signed thumbnails, not images.** The ones in this feed are
  140x78 with the dimensions baked into an `s=` signature, so the width cannot be raised.
  `fullSize()` swaps the same image id onto i.redd.it, which is the untouched upload —
  verified: the preview 403s, i.redd.it returns 1920x1080. `external-preview.redd.it` is a
  thumbnail of a third-party page and is left alone.
- **A crest is composed, never shown raw.** `CrestTile` draws it large on the org's brand
  colour from `teams.ts`, filling a square. That square, repeated post after post, is what
  makes a feed read as a publication; the same logo transparent on dark reads as an asset
  that failed to load.
- **An aggregator's graphic is watermarked, and that is the real objection.** A Telegram
  channel's quote card carries its handle and logo, so posting it republishes their asset
  under your name — which is what separates an account people follow from one they recognise
  as a mirror. It is labelled "Carries the channel's watermark" and ranked LAST, behind every
  original alternative, rather than removed: sometimes it is the only picture of a moment.
- **`ResultCard` is the answer to that, not a nicety.** The facts of a match belong to
  nobody, so the picture of them can be ours: both crests on their brand colours, the score
  across the seam, the event beneath. `parseResult` is deliberately strict — both sides must
  resolve to crests we hold, because a scoreboard naming the wrong winner is worse than none.
- **Never attach a bare team crest as a post image.** They are transparent PNGs drawn for a
  white wiki page — some dark, some wordmarks, some thin line art — and posted raw they read
  as a missing asset. `QuoteCard` sets them on a consistent rounded plate instead, which is
  what makes a run of posts look like one publication rather than a scrape.
- **The image often IS the news.** A Reddit item like "Glock-18 | Floating Camo" is a skin
  concept; posting that headline beside a generic game capsule is worse than not posting it.
  `reddit.ts` pulls the full-size image from the entry content, preferring i.redd.it and
  preview.redd.it links over the tiny media:thumbnail.
- **Plan media from the ORIGINAL item, never the translated one.** Translating a post does
  not translate the text burned into its screenshot. Planning from the translated item made
  the Russian caution vanish and stopped offering the English card, on a post whose picture
  was still entirely in Russian. `ItemCard` composes words from the translated item and
  pictures from the original, on purpose.
- **Telegram posts carry clips, and the clip is often the whole post.** A video attachment
  puts its still under `tgme_widget_message_video_thumb` rather than the photo class, so
  reading only the photo class returned nothing at all for those; and the `<video src>` is a
  direct mp4 that can be attached as footage. "What are BC.Game players doing at the
  bootcamp" had neither until both were read.
- **Two kinds of HLTV picture, and they are not interchangeable.** The EDITORIAL photo at
  the top of an article is real event photography served up to 1600px — that is what a post
  carries. The BODYSHOT cutout in a player hover card is 200-400px, soft on a 1080 square,
  and only the fallback. Editorial is keyed to whoever the HEADLINE names: keying to every
  link meant one match report attached its photo to all ten players in it, so apEX, MOUZ and
  Spirit all resolved to the same picture.
- **"Is it foreign?" is not an alphabet question.** The first version asked only whether the
  text contained Cyrillic, so a FURIA post reading "Já temos data marcada para voltar ao
  servidor!" went out untranslated — Portuguese is written in the same alphabet as English.
  Half the orgs worth following post in Portuguese, Spanish or French. `lib/language.ts` now
  runs two tests: unreadable SCRIPT (Cyrillic, Greek, Arabic, Hebrew, CJK, Thai, Korean),
  and FUNCTION WORDS for Latin-alphabet languages — "para", "nous", "und", "för". Two hits
  required, because one foreign word appears in English posts and a Translate button on an
  English post trains the eye to ignore it. Content words are useless here: CS posts are
  mostly names, and names travel. Diacritics deliberately do not count — "Håvard" and
  "Zörter" are English-post material. Verified against the live feed: 6 of 60 flagged, all
  six genuinely foreign, ZERO false positives across the other 54. Words that collide with
  English are excluded by hand and the list of exclusions is the interesting part: German
  "die", Polish "do", Danish "at" are English words; "eu" is how everyone writes Europe; and
  "de"/"do" would fire on every map name, because "de_dust2" tokenises to "de" + "dust2".
  Read a candidate as a CS word before adding it.
  KNOWN BLIND SPOT: a post too short to contain two function words — "Tudo normal." — reads
  as English and gets no button. Accepted, because loosening to one hit puts the button on
  English posts, and a two-word post is not a story anyway.
- **English never reaches the translator.** Told to return English text unchanged, the model
  rewrote "JUST IN: donk drops 30 kills as Team Spirit take Nuke off FaZe" into "donk scores
  30 kills as Team Spirit win Nuke over FaZe" — label gone, line reworded for nothing. An
  instruction a model reliably disobeys is not a rule, so `/api/translate` short-circuits on
  `needsTranslation` before calling out. Same test as the button, so the two cannot disagree.
- **The translator is never told which language it is reading.** Portuguese and Spanish share
  most of their function words, so labelling would mean guessing, and a model handed a wrong
  language label follows the label instead of the text. It gets the text and works it out.
- **An X post's subject is its AUTHOR, not what the text names.** That FURIA post named only
  its next opponent, so reading the team out of the text put the GamerLegion crest on FURIA's
  own announcement. `xPosts.ts` carries `team`/`player` per account and sets them on the item;
  the feed uses `item.teamPage ?? teamInText(...)`. Where a source knows a fact, reading the
  text can only be a guess.
- **A Russian source image is never offered, at any position.** It was kept last on the
  reasoning that it is sometimes the only picture of a moment; it is not. It is a graphic
  the audience cannot read wearing another outlet's watermark, and it will not be posted, so
  listing it only costs a slot and a decision. The story is still used — retold in English
  with our own pictures.
- **HLTV bodyshots are harvested from articles, because there is no lookup.** Their player
  pages and search answer 403; their articles answer 200, and every article embeds a hover
  card per player mentioned, carrying that player's photo. The nickname comes from the
  image's alt text — "Justinas 'jL' Lekavicius" — so the pairing is exact rather than
  inferred. Coverage is whoever has been in the news recently, which is close to whoever you
  are posting about; anyone missing falls back to Liquipedia.
- **HLTV photo URLs cannot be proxied or drawn on a canvas.** The CDN answers a browser and
  refuses a server, so `/api/hltv-photo` returns the URL and the page loads it directly.
  That makes it cross-origin, hence a plain tile rather than part of the matched square.
- **The pair must be the same square.** X lays two attachments side by side and crops them
  to a shared height, so a tall portrait beside a wide capsule becomes two mismatched
  slivers. `PostImages` renders both onto a 1080 square — cover-cropped and biased upward
  for a face, contained with a wide margin for a crest — so the pair always sits flush.
- **Never render a slot with nothing in it.** An empty coloured square looks like a finished
  image, so it gets attached and the post goes out with a blank tile. `PostImages` hides a
  slot whose source did not load and drops to a single column.
- **`planMedia` offers, it does not choose.** An earlier version picked two images and
  discarded the rest — including the source screenshot on every Russian item — which left a
  run of posts all wearing the same game capsule. Which picture tells the story cannot be
  decided from a headline, so every option is shown, ordered by how specific it is to this
  story, and the person posting picks. Foreign-language screenshots are labelled, not
  removed. `QuoteCard` still refuses to bake one into the generated English card.
- **Never hide a media option that failed to load.** A labelled "did not load — tap Retry"
  tile says the option exists and the miss is probably temporary; a vanishing tile just
  looks like nothing was found. Most misses are Liquipedia's rate limiter, so retrying works.
- **A skin post shows the skin.** `csItems.ts` resolves "Weapon | Finish" names against a
  community mirror of Valve's item files and returns the official Steam image. A miss is
  often correct rather than a bug: community concept art posted to Reddit — "Glock-18 |
  Floating Camo" — is deliberately not in that dataset, and the right picture is the one
  Reddit attached.
- **Player nicknames are guessed, and that is fine.** `players.ts` reads the two shapes CS
  headlines actually use — `nick: "quote"` and `nick <verb>` — rather than trying to hold a
  list of thousands of players whose churn is itself the news. A wrong guess costs nothing:
  `/api/photo` 404s and the post falls back to the crest.
- **Groq's free tier is 8,000 tokens per MINUTE, and write-ups hit it.** Five write-ups in
  quick succession returned `429 ... on tokens per minute (TPM): Limit 8000`. Nothing is
  broken; the card shows the message and the next one works. Worth knowing before blaming
  the app for a write-up that failed in a burst.
- **Model output carries characters nobody types.** Live write-ups came back with
  "Counter‑Strike" and "2‑1" using U+2011, the non-breaking hyphen — visually near-identical,
  and one of the quiet tells that a post was machine-written. `correctNames` normalises those
  plus no-break/thin spaces and zero-width junk. Curly apostrophes and quotation marks are
  deliberately left alone: both studied accounts use them, and straight quotes are the tell
  in the other direction.
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
- **The composed square is shown as an `<img>`, not a `<canvas>`, and that is the whole
  point on a phone.** iOS offers "Add to Photos" on a long-pressed `<img>` and nothing at
  all on a canvas — and the camera roll is where X's attach sheet looks. The canvas still
  does the drawing and stays as the fallback when a cross-origin photo taints the export.
- **`x.com/intent/post?text=` opens X's composer with the post already in it.** Public URL,
  no key, no API — verified live; on iOS it redirects to `x-safari-https://` and hands off
  to the X app. It cannot carry an attachment, so the flow is: save the two squares, tap
  Open in X, attach, post. The clipboard is filled first regardless, because the intent URL
  is one X change away from breaking and a tap must never be a dead end.
- No source image means the quote card is the media. `needsCard` on the draft flags it and
  the card button turns purple.
- **Telegram is `cstracker` only, and that is not a news outlet.** It reports Valve build
  changes detected from Steam depots, which lands before any announcement. `newcsgo` was
  removed: it is CS2NEWS's own channel, the same operation as their X account, so reading it
  meant being behind them by construction — they publish to both at once and anything found
  there is already out in English. A source you cannot beat is a competitor, not a source.
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

### Writing
`/api/writeup` turns a headline into the three-part post the incumbents use: a LEAD SENTENCE
in our own words, the quote verbatim, then a closing fact.

**The prompt used to ask for a "hook" — the speaker's boldest line, in quotation marks, on
line one.** Neither studied account does that in any post. They say what the quote is ABOUT
and let you read it: the lead is a promise and the quote is the payoff, and opening with the
payoff spends it. The model now writes the lead and never touches the quote.

**The emoji is a TAP, not a model call — and that was learned the hard way.** Asked to write
up a RETIREMENT the live model returned 🏆, with the prompt naming that exact mistake in the
line above. The prompt now defaults to none and lists the cases that do not qualify (verified
live: retirement, transfer and a schedule all come back empty), the route enforces an
allowlist of the five documented emoji, and the card offers those five as chips so the person
reading the draft settles it in one tap. An allowlist cannot stop a wrong choice from inside
the set; only a human can, so a human does.

**It also picks the emoji, including picking none.** Which emoji fits is a judgement about
tone that needs the story — 😭 candid, 💀 humiliating, 🥶 an unexpected number. There used to
be a `|| KIND_EMOJI[...]` fallback in `compose.ts` that overrode the model's deliberate
empty string, so every post came out wearing 👀 whatever it was about. The fallback now
applies only to a bare headline, which has nobody to make the judgement. HLTV articles are fetched
first so the lead is written from the story rather than from its own headline — that summary
cannot be derived from the quote alone, and it is the whole difference between the formats.
The quote is passed through untouched, never regenerated, so the one part that must be exact
cannot drift. Nothing may be invented; the prompt says so and the source text is all it gets.

All model calls go through `lib/llm.ts`. Everything painful was learned there: the model is
discovered rather than hardcoded, the token budget is generous because these are reasoning
models and the budget covers the thinking, and every failure records why.

### Ordering
Newest first by default; `?sort=score` returns the ranked order and the UI toggles it.
Score decides what is worth posting, time decides what is new, and ranking by score buries
the thing that just landed behind something better from three hours ago.

### X is readable, for individual posts
`cdn.syndication.twimg.com/tweet-result?id=<id>&token=<t>` returns a public post's full
text and media URLs, free and unauthenticated. The token is derived from the id:
`((id / 1e15) * Math.PI).toString(36)` with zeros and the dot stripped. WebFetch gets 402
from x.com and the API has no free tier, which led to this being written off twice —
neither fact rules out the syndication endpoint. Profile TIMELINES are not enumerable
this way, so it reads posts you already have ids for; it does not discover them.

### Media
Every post carries an image; the card blocks copying until one exists. An item that names a
known team gets that team's Liquipedia badge, whatever the source, so a roster story goes
out wearing the right crest. Game updates carry two images — the news and the game — which
is how the accounts that own this beat post them.

### Post format — read off @Ozzny_CS2 and @cs2files, not invented
Eleven of their posts were fetched and studied (text, media, dimensions). Every one is three
blocks separated by blank lines:

```
{a sentence saying who did or said what}{one emoji, optional}

{the quote in curly quotes, or the background paragraph, or a "> " list}

{one closing fact}
```

**What they never do — and this file used to do all four.** No `JUST IN:` or `RUMOR:`
prefix (zero of eleven); the opening line is a SENTENCE — "ruggah has officially retired
from coaching after more than a decade in Counter-Strike" — or an attribution — "donk on
what makes tN1R so good:". No lone emoji on its own line; Ozzny closes the LEAD line with
one, inline (5/5), cs2files usually none (1/5). No "via @handle" in the body; neither
credits a source in the text, ever. No link in the body.

**What they always do.** Media on every post. Curly quotation marks. `> ` bullets for a list
of two or more, never for one line. Lead with the human.

`‼️` is used, but only inline at the end of a title headline — "Spirit are your BLAST Porto
CHAMPIONS 🇵🇹‼️". Anywhere else it reads as punctuation debris.

### The image pair — what actually goes in the second slot
Also read off the two accounts, by downloading their attachments and measuring them:

| The story | Left | Right |
|---|---|---|
| Two people in it | face | **the other face** |
| One person + their org | face | crest on the org's brand colour |
| A quote about a thing | face | a picture of the thing (magixx on drinking water → a glass of water) |
| A title won | the trophy | the stage and the crowd |
| A clip | the video alone | — |

**Two faces is the commonest pair in both accounts** — cs2files ran donk beside tN1R,
Ozzny ran donk beside NiKo — and `PostImages` could not make it until it was given
`second`. The crest is the FALLBACK, not the default.

**Every image in an account is the same aspect ratio.** cs2files is strictly 1:1
(1080×1080, 1440×1440, 690×690, 481×481, 360×360 — measured). Ozzny is strictly 0.879
(690×785, 686×780). X crops a side-by-side pair to a shared height, so mixing ratios is what
produces the two mismatched slivers. This app renders 1080 squares, which is cs2files' shape.

Their crest treatment is exactly `CrestTile`: cs2files' ruggah post ran the Astralis star
large and white on solid brand red, filling a 360 square. That was confirmed, not assumed.

## Current state
**Translation now covers every language, not just Russian.** `lib/language.ts` decides it;
`/api/translate` takes any source language and is never told which. Verified against the live
feed: 6 of 60 items flagged (five Portuguese X posts, one Russian Twitch title), 54 English
items untouched with no false positives. Exercised against the live deployment in Portuguese, Spanish, French and
Russian — the FURIA line came back "We already have a date set to return to the server!" and
the Russian one resolved Соколов/Монеси to Falcons/m0NESY, so the glossary still holds. First-party X posts now carry the crest of the account that POSTED them
rather than of whatever team the text happens to name.

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

### X posts — how the browse actually works
X has no free API and WebFetch gets 402, but public posts ARE readable in two steps:
the profile page at `x.com/<handle>` is a JS shell whose HTML still embeds the ids of the
newest few posts, and `cdn.syndication.twimg.com/tweet-result` — the endpoint X uses to
render embeds — returns any public post's full text and media by id, unauthenticated, with
a token derived arithmetically from the id. Neither step needs a key.

DEPTH IS CAPPED at about five per account and cannot be raised — those are the ids X embeds
for search engines. Every widening was tried and failed: mobile UA, /with_replies, /media,
twitter.com, and the embed timeline widget, which returns an empty shell because its entries
come from a gated client call. The answer is BREADTH: seventeen accounts at five each.

Because that is a lot of requests, the sweep runs to a TIME BUDGET (6s) from a rotating
offset, so one refresh reads what it can afford and the next starts elsewhere; the shared
Data Cache carries the rest. A feed that arrives having read twelve accounts beats one that
times out having read all seventeen.

Accounts are marked `csOnly`. The ones that are not — Dexerto, Richard Lewis — cover all of
gaming and arrived carrying a Rockstar story and a mountain rescue, so their posts must
match CS terms; a dedicated CS account's are taken whole, since filtering those would drop
roster news that happens not to say "CS".

It WILL break whenever X changes either page: treat a sudden empty result as that, not as
the accounts going quiet. Requests are sequential because parallel scraping gets blocked.

Why it matters: a post carries its author, so a quote arrives already attributable to the
handle that said it — which is exactly what a news account needs and what a transcript
lacks. Scored highest for that reason.

Automatic transcription of interviews is NOT available, and this was established properly
rather than assumed. The watch page returns a 3KB stub; the internal `youtubei/v1/player`
endpoint answers `LOGIN_REQUIRED — "Sign in to confirm you're not a bot"` for every client
context (ANDROID, IOS, WEB, TVHTML5). That is an IP-reputation block on datacenter ranges,
not a missing parameter. Do not spend time re-testing it.

### YouTube — the interview source
`youtube.ts` reads HLTV's channel, which carries HLTV Confirmed: their talk show, three
hundred-odd episodes of players and analysts on the record. Episode titles are effectively a
contents page — "lauNX talks FUT & future; Techno to BCG, Snappi to coach?" names three
stories before a second is watched. Titles are filtered to interview shapes and AGAINST
highlight shapes, because the same channel posts clips and a clip of an ace is not a quote.
Per-channel RSS is free with no key and no quota, unlike the Data API.

Tournament channels were tested and rejected: BLAST and ESL upload highlights, PGL's channel
is Dota. Highlights are covered by Twitch, sooner and closer to the moment.

### Twitch
`twitch.ts` asks two different questions. The TOURNAMENT channels (blastpremier, esl_csgo,
pgl_esports, blasttv) are where post-match interviews get clipped — that is the quote source
HLTV cannot match, since a broadcast produces an interview after every series and HLTV writes
up about two a day. Separately, the hardest-clipped Counter-Strike clips game-wide surface a
moment while it is happening. Needs `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`; without
them the source raises and the feed carries on. The app token is cached — Twitch's last
about 60 days, so re-requesting one per feed refresh would be pointless traffic.

### Where the quotes actually come from
The accounts with quotes HLTV does not have are taking them from BROADCASTS, not articles —
a post crediting `@BLASTPremier` for a quote means the post-match interview aired on the
stream, and caster opinions come from streams and podcasts. Tournament YouTube channels do
NOT carry these: BLAST and ESL upload highlights, and PGL's channel is Dota (tested, all
three). The route is Twitch clips, which needs a free Twitch app (client id + secret) — the
one meaningful source still missing.

## Next
- Deploy: run `node apps/hub/scripts/setup-vercel-project.mjs --repo projects --name mantas-newsdesk --slug newsdesk`, then fix the real URL in `apps/hub/config/apps.json`.
- Add `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` to the Vercel project to turn the Twitch source on. The code is wired and reports "Twitch keys not configured" until they exist.
- Translate and classify the Russian Telegram posts. Needs a free `GROQ_API_KEY` or `GEMINI_API_KEY` added to the Vercel project — neither is set today, which is why `looksLikeNews` is a regex rather than comprehension.
- Add the streamer layer: Twitch Helix for live/offline transitions and clip-view velocity, which finds a viral moment before it is viral on X. Needs a free Twitch app (client id + secret).
- Add a Polymarket detector: `https://data-api.polymarket.com` is public and unauthenticated, so large position opens by top-ranked wallets are free to compute and nobody is posting them in a clean format.
- Push instead of pull, once the feed proves itself: Supabase `pg_cron` + `pg_net` on a one-minute schedule, writing new items to a table and firing a web push.
