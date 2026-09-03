# First-time setup

> **Status: done.** This repo is set up. The values that filled the placeholders below:
> owner `Mantas` (`markamantas9@gmail.com`) · GitHub `Mantukasss/Projects` ·
> Vercel prefix `mantas` (team `TWITTER`, `team_5qHcbqn3fpmctrIR2pEtT3Sd`) ·
> Supabase ref `tsyozhctvotcgqpqrbrr`. Kept as a record of what setup involves, and as the
> checklist to follow if the portfolio is ever rebuilt on fresh accounts.

This repo is the infrastructure only — the monorepo tooling, the hub launcher, and the
rules in `CLAUDE.md` / `SCHEMA_RULES.md`. No portfolio apps yet.

Work top to bottom. Each step is independent of the next except where noted.

## 1. Fill in the placeholders

Every `<angle-bracket>` token is a value to replace. Find them all:

```bash
grep -rn "<owner-name>\|<owner-email>\|<github-owner>\|<vercel-prefix>\|<supabase-project-ref>\|<repo>" --exclude-dir=node_modules --exclude-dir=.git .
```

| Placeholder | What it is | Where it appears |
|---|---|---|
| `<owner-name>` / `<owner-email>` | You | `CLAUDE.md` |
| `<github-owner>` | Your GitHub user or org | `CLAUDE.md`, setup script default (`GITHUB_OWNER`) |
| `<repo>` | This repo's name on GitHub | `CLAUDE.md` |
| `<vercel-prefix>` | Prefix for Vercel project names, e.g. `myname-hub` | `CLAUDE.md` |
| `<supabase-project-ref>` | Supabase project ref (from its dashboard URL) | `CLAUDE.md`, `SCHEMA_RULES.md`, `apps/hub/.env.example` |

Then delete the "set up from a template" note near the top of `CLAUDE.md`.

## 2. Create the accounts

- **GitHub** — push this repo (a private repo is fine).
- **Supabase** — one free project for the whole portfolio (iron rule #3). Note the project
  ref, URL, and anon key. Enable the **Google** auth provider.
- **Vercel** — free/Hobby account. Install the Vercel GitHub App and grant it access to
  this repo.
- **Google Cloud** — an OAuth client for Supabase's Google provider (Supabase's auth docs
  walk through this; the redirect URL is
  `https://tsyozhctvotcgqpqrbrr.supabase.co/auth/v1/callback`).

## 3. Set the env vars

Locally, copy `apps/hub/.env.example` to `apps/hub/.env.local` and fill in the Supabase
URL and anon key. In your agent session / CI, set the full list documented in
`CLAUDE.md` → *Session env vars*: `GITHUB_TOKEN`, `VERCEL_TOKEN`, `VERCEL_TEAM_ID`,
`SUPABASE_ACCESS_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(plus `GEMINI_API_KEY` / `GROQ_API_KEY` only when an app needs AI).

Allowlist `api.vercel.com` and `api.supabase.com` for outbound network access.

## 4. Apply the hub's SQL

Run `apps/hub/supabase/sql/0001_hub_user_app_preferences.sql` in the Supabase SQL editor
(or via the Management API). It creates the `hub` schema with RLS.

Then expose the `hub` schema to the Data API — **both** places, per `SCHEMA_RULES.md`
→ *New Postgres schemas*.

## 5. Deploy the hub

```bash
npm install
node apps/hub/scripts/setup-vercel-project.mjs \
  --repo Projects --name mantas-hub --slug hub --github-owner Mantukasss
```

Then in Supabase → Authentication → URL Configuration, add the hub's production URL to the
redirect allow list (`https://mantas-hub.vercel.app/auth/callback`), plus
`http://localhost:3000/auth/callback` for local dev.

## 6. Verify

```bash
npm run dev -- --filter=./apps/hub
```

Sign in with Google; you should land on the hub's empty state ("No apps yet"). That is the
correct result — `config/apps.json` ships as `{"apps": []}`.

## 7. Add your first app

Follow **CLAUDE.md → Full automation — new app checklist**. `apps/hub` is the reference
implementation for the per-app shape: Next.js 15 App Router, Tailwind + Radix Colors dark,
Supabase SSR auth (`lib/supabase/{client,server,middleware}.ts` + `middleware.ts` +
`app/auth/callback/route.ts`), PWA manifest + `sw.js`, and a `vercel.json` with the
`ignoreCommand`.

## What was intentionally left out of this copy

Carried over: monorepo tooling (npm workspaces + Turborepo), the hub launcher app, the
Supabase SSR auth + PWA patterns, `scripts/vercel-ignore.sh`, and all the rules and
conventions docs.

Not carried over: the portfolio apps themselves, their Supabase migrations, their GitHub
Actions cron workflows (those were app-specific), app icons, and the original owner's
account identifiers and project refs.
