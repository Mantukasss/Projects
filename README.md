# Personal apps — monorepo

A personal app portfolio in one repo: shared rules, schema, and tooling live in one place,
and a new app is just a new folder (no new repo, no new access grant).

## Layout

```
.
├── CLAUDE.md            # project spine — rules & conventions (canonical, repo-wide)
├── AGENTS.md            # routes non-Claude agents to CLAUDE.md
├── SCHEMA_RULES.md      # additive-only schema rules (canonical, repo-wide)
├── SETUP.md             # one-time setup: placeholders, accounts, tokens
├── docs/                # operational notes (Vercel build skipping, …)
├── scripts/             # repo-wide automation (vercel-ignore.sh)
├── apps/
│   └── hub/             # launcher PWA — lists the apps below (config/apps.json)
└── packages/            # (reserved) shared code, once extracted
```

Each `apps/<name>/` also carries its own **`README.md`** (what the app is) and **`CLAUDE.md`**
(technical context and handoff state for coding agents; see the root `CLAUDE.md`).

## Apps

| App | Folder | What it is |
|-----|--------|------------|
| Hub | `apps/hub` | Launcher that lists the apps |

_No portfolio apps yet — `apps/hub/config/apps.json` is empty. Add the first one via the
new-app checklist in `CLAUDE.md`._

All apps share one Supabase project (Postgres schema per app) and run on the Vercel free
tier. See `CLAUDE.md` for the full spec.

## Develop

Uses npm workspaces + Turborepo.

```bash
npm install                          # install all workspaces from the root
npm run dev                          # run every app (turbo)
npm run dev -- --filter=./apps/hub   # run a single app by folder
npm run build                        # build all
npm run lint                         # lint all
```

Per-app commands also work from inside each `apps/*` folder.

## Deploy

Each app is its own Vercel project pointing at this repo, with **Root Directory** set to
its `apps/<name>` folder. Build skipping is configured in-repo via each app's `vercel.json`
`ignoreCommand` (see `docs/vercel-ignore-build.md`), so a push only rebuilds the apps that
actually changed. Production ships from `main`; roll back via Vercel's deployment history.

## First-time setup

See **`SETUP.md`** — placeholders to fill in, accounts to create, tokens to set.
