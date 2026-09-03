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
- Prod: Vercel project `<vercel-prefix>-hub`, Root Directory `apps/hub`

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
Not yet deployed. The code is complete and working: Google OAuth sign-in/landing, the app
grid from `apps.json`, PWA install, and service-worker registration. `config/apps.json` now
carries one entry — `newsdesk` — with a placeholder production URL, because the repo's
`<vercel-prefix>` placeholder is still unfilled; the URL needs correcting once that Vercel
project exists. `public/app-icons/` is still empty, so the tile renders the Tabler `news`
glyph fallback rather than a real PWA icon.

A palette bug was fixed here: `<html>` now carries `className="dark"`. Radix Colors v3
scopes its dark scales to `.dark, .dark-theme` rather than `:root`, so without that class
every `--mauve-*`/accent token was undefined and the whole design system silently fell back
to browser defaults. Any new app copied from this one inherits the fix.

## Next
- Complete root `SETUP.md` (placeholders, Supabase project, Vercel project, auth redirect URLs), then deploy.
- Replace the placeholder `newsdesk` URL in `config/apps.json` with the real one after running `scripts/setup-vercel-project.mjs` for it, and drop its icon at `public/app-icons/newsdesk.png`.
- The reserved `hub.user_app_preferences` table is the obvious hook if/when you want a per-app version picker.
