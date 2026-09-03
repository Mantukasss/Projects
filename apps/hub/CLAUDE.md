# Hub — app context (`apps/hub`)

> Read the repo-root `CLAUDE.md` and `SCHEMA_RULES.md` first — they govern every app.
> **Keep `Current state` and `Next` (bottom) up to date — update them after every change to this app.**

The launcher PWA. Google sign-in, then a grid of tiles — one per app — read from
`config/apps.json`. Tapping a tile opens that app's production URL.

## Stack
- Next.js 15 (App Router, `next ^15.5.18`) + React 19 + TypeScript
- **`src/` layout** (`src/app`, `src/components`, `src/lib`)
- **Legacy ESLint** (`.eslintrc.json` + `next.config.js`)
- Tailwind 3 + Radix Colors, Tabler icons (`@tabler/icons-react`), Supabase SSR (Google OAuth)
- Extra npm scripts: `typecheck` (`tsc --noEmit`) and `setup-vercel` (`scripts/setup-vercel-project.mjs`, bootstraps new Vercel projects)
- Prod: Vercel project `mantas-hub`, Root Directory `apps/hub`

## Conventions
- The tile registry is `config/apps.json`, read via `src/lib/apps.ts` (`getApps()`, typed `AppDefinition`). Imported at **build time** — edit JSON, then redeploy.
- **Tiles are home-screen-style app icons** (`AppTile`): a rounded squircle + name label, no card/border/description — the grid reads like a phone folder. Each app's real PWA icon lives in `public/app-icons/<slug>.png` and is referenced by `iconImage` in `apps.json`, rendered via `next/image`.
- **`iconImage` is preferred; the Tabler `icon` is the fallback** when an app has no image (renders the glyph on a colored tile). Either way, **map every `icon` in `src/lib/icons.ts`** so the fallback is sensible.
- `color` must be one of the 8 palette names listed in the root `CLAUDE.md`.
- Components: `AppGrid`/`AppTile` (grid), `HubHome`, `SignInLanding`/`SignInWithGoogle`/`SignOutButton`, `ServiceWorkerRegistrar`.

## Data model
- `hub.user_app_preferences (user_id, app_slug, preferred_version, updated_at)` — `supabase/sql/0001_hub_user_app_preferences.sql`. **Reserved, not used** — tiles always open `stable`. Kept in place per the additive-only rule.

## Gotchas
- Adding an app is **two steps**: edit `config/apps.json` **and** map its icon in `src/lib/icons.ts`. For the home-screen look, also drop the app's real icon at `public/app-icons/<slug>.png` and set `iconImage`; without it the tile shows the Tabler glyph fallback.
- App icons in `public/app-icons/` are **copies** of each app's `public/icons/*-512.png`. If an app's icon changes, re-copy it here (build-time asset, needs redeploy).
- `apps.json` is build-time — a tile change needs a redeploy, not just a data edit.
- This app is also the **reference implementation** for new apps: Supabase SSR auth, PWA manifest + `sw.js`, dark Radix theme. Copy the patterns from here rather than reinventing them.

## Current state
Infrastructure is wired up; awaiting its first production deploy. The code is complete and
working: Google OAuth sign-in/landing, the app grid from `apps.json`, PWA install, and
service-worker registration. `config/apps.json` is `{"apps": []}`, so the hub renders its
empty state ("No apps yet"). `public/app-icons/` is empty.

Live infrastructure:
- Vercel project `mantas-hub` (`prj_mOrpJ65LaFCNPyRoIMHTTgBXoOmr`), team `TWITTER`,
  Root Directory `apps/hub`, production branch `main`. `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set on the project for all three targets.
- Supabase `tsyozhctvotcgqpqrbrr`: `hub.user_app_preferences` exists with RLS on and the
  four owner-only policies. The `hub` schema is exposed to the Data API in both places
  (`postgrest.db_schema` and `authenticator`'s `pgrst.db_schemas`), reloads sent.
- Google OAuth enabled. `site_url` is the hub's production URL; the redirect allow list
  covers production, `mantas-hub-*.vercel.app` previews, and `localhost:3000`.

## Next
- Merge to `main` to trigger the first production build, then sign in with Google on
  `https://mantas-hub.vercel.app` and confirm the empty state renders.
- The session env var `NEXT_PUBLIC_SUPABASE_ANON_KEY` holds a masked-paste value
  (`eyJhbGci` + bullet characters) and is rejected by the Data API. Vercel has the correct
  key, so deploys are fine, but anything reading that env var directly — the setup script
  for the next app, local `next dev` — will fail until it is re-pasted.
- The reserved `hub.user_app_preferences` table is the obvious hook if/when you want a per-app version picker.
