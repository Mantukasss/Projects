# `scripts/`

Bootstrap automation for the portfolio. These scripts are run from agent/dev sessions, not
from the deployed app.

## `setup-vercel-project.mjs`

Creates a Vercel project for an app in this monorepo: links it to the GitHub repo, sets the
production branch (`main`) and Root Directory (`apps/<slug>`), and injects the standard
Supabase env vars.

### Prereqs

- This monorepo must already exist on GitHub.
- The Vercel GitHub App must have access to it (easiest: grant "All repositories" once at
  <https://github.com/settings/installations>).
- These env vars must be set in the session:
  - `VERCEL_TOKEN` — generated at <https://vercel.com/account/tokens>
  - `VERCEL_TEAM_ID` — find at <https://vercel.com/account> ("Your ID")
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `GITHUB_OWNER` (or pass `--github-owner`)

The tokens are personal secrets — keep them in the session env vars panel, never in the repo.

### Run it

```bash
npm run setup-vercel -- --repo <repo> --name <vercel-prefix>-workout --slug workout
```

Optional flags:
- `--prod-branch <name>` — production branch (default: `main`)
- `--github-owner <name>` — GitHub owner (default: `$GITHUB_OWNER`)

### Output

The production URL once Vercel finishes the first build: `https://<name>.vercel.app`.

### Surrounding steps (an agent does these in-session, no separate script needed)

1. Scaffold `apps/<slug>` with its `README.md` and `CLAUDE.md`, plus a `vercel.json`
   carrying the `ignoreCommand` (see `docs/vercel-ignore-build.md`).
2. Apply the app's SQL migration to the shared Supabase project.
3. Add the new production URL to Supabase's auth redirect allow list.
4. Add the app's entry to `apps/hub/config/apps.json` and map its icon in
   `apps/hub/src/lib/icons.ts`.
5. Push to `main` so the new tile ships.

The root `CLAUDE.md` documents the whole discovery-and-execution flow; this script is just
the deterministic Vercel piece.
