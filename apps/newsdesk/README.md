# Newsdesk

A breaking-news console for a CS2 esports account on X. It watches the sources that break
Counter-Strike news, ranks what is worth posting right now, and hands you a finished post —
body, source reply, and an image — so posting is a copy and a paste instead of a writing job.

## Why it exists

A news account's only product is being early. The bottleneck is never typing speed; it is
knowing a thing happened and having the post already written when you find out. Newsdesk
does the second half, and for one source it does the first half too.

## What it does

- **Watches HLTV** (RSS). Every item arrives with a headline, a summary and an image, and
  HLTV writes interview headlines as `player: "quote"` — the exact shape that performs on X.
- **Watches Liquipedia's edit stream** for roster moves. Editors update player and team
  pages within minutes of a move becoming known, often before an English-language site
  writes it up. When several player pages and a team page are edited inside the same
  20-minute window, that is a roster shuffle being documented live, and Newsdesk surfaces
  it as one lead. These are leads, not confirmed stories, and the app writes them hedged.
- **Ranks the feed** by freshness first (45-minute half-life), then source, format and
  engagement terms. The reasons behind each score are printed on the card.
- **Writes the post** in the format the accounts that already won this niche actually use:
  no link in the body, media always attached, human before headline, short.
- **Generates the image** when the source has none, as a quote card you save and attach.

## Two buttons, and why there are two

`Copy post` gives you the body. `Copy reply 1` gives you the source link, separately, on
purpose. X's ranking suppresses posts that carry an external link, and X's own API prices a
post with a link at $0.20 against $0.015 without one — the platform charges 13x for the
thing it also demotes. So the link goes in the first reply, which is what Culture Crave,
Ozzny and the rest do. The two buttons make that the path of least resistance.

## Running it

```bash
npm install
npm run dev --workspace newsdesk
```

No database, no API keys, no cron. The feed is fetched on request and cached for 60–90
seconds, which is why it costs nothing to run and works on Vercel's free tier as-is.

- **Watches Valve** through Steam's news API for Counter-Strike 2. A game update is the one
  story every player cares about at once, it lands with no warning, and it is unauthenticated
  to read.
- **Watches r/GlobalOffensive** as early warning — clips and drama surface there before the
  sites write them up.
- **Attaches the team badge** to roster leads, pulled from the team's Liquipedia infobox, so
  a roster post ships with media rather than as bare text.

## Sources that are wired but off

- **VLR.gg** (VALORANT) — works, off by default. One game per account beats two: X ranks an
  account by the audience cluster that engages with it, and two games split that cluster.
  Turn it on for a second, VALORANT-only account rather than mixing it into this one.
