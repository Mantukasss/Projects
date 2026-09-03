# Hub — personal app portfolio launcher

A launcher PWA that lists every app in the portfolio as a tile. Sign in with Google and tap
a tile to open that app's production deployment.

Part of the monorepo — this app lives in `apps/hub`. Project-wide rules live in the
repo-root `CLAUDE.md` and `SCHEMA_RULES.md`.

## Apps

None registered yet. The tile list is `config/apps.json` (one entry per app), imported at
build time — edit it and redeploy to change the tiles.

## Stack

Next.js 15 · TypeScript · Tailwind CSS · Radix Colors (dark only) · Supabase (Postgres + Google OAuth) · Vercel free tier

## Run it

```bash
cp .env.example .env.local   # fill in the Supabase URL + anon key
npm install                  # from the repo root
npm run dev                  # from this folder, or `npm run dev -- --filter=./apps/hub` at the root
```

## Adding a new app

Add a folder under `apps/<name>`, register it in `config/apps.json`, map its icon in
`src/lib/icons.ts`, and create a Vercel project pointing at this repo with Root Directory
`apps/<name>`. No new GitHub repo — it's all one monorepo. See the repo-root `CLAUDE.md`
for the full spec.
