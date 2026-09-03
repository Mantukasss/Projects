#!/usr/bin/env node
/**
 * Creates a Vercel project for a new app in this monorepo.
 *
 * What it does:
 *   1. Calls the Vercel API to create a project linked to this GitHub repo
 *   2. Sets the production branch (default: `main` — all apps ship in lockstep)
 *   3. Sets the project's Root Directory to `apps/<slug>` so the monorepo builds correctly
 *   4. Injects the shared Supabase env vars (read from session env, not hardcoded)
 *   5. Prints the expected production URL once Vercel finishes the first deploy
 *
 * Prerequisites:
 *   - This monorepo must already exist on GitHub
 *   - The Vercel GitHub App must have access to it (easiest: grant "All repositories")
 *   - These env vars must be set:
 *     VERCEL_TOKEN, VERCEL_TEAM_ID,
 *     NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   - GITHUB_OWNER, or pass --github-owner
 *
 * Usage:
 *   node scripts/setup-vercel-project.mjs --repo Projects --name <vercel-project> --slug <app-folder>
 *
 * Optional flags:
 *   --prod-branch <branch>   Production branch name (default: main)
 *   --github-owner <owner>   GitHub owner (default: $GITHUB_OWNER)
 *
 * After it runs, still manual: set the project's Ignored Build Step if you are not using
 * the in-repo `vercel.json` ignoreCommand, and add GEMINI_API_KEY / GROQ_API_KEY if the
 * app uses AI.
 */

import { parseArgs } from "node:util";

const VERCEL_API = "https://api.vercel.com";

const token = process.env.VERCEL_TOKEN;
const teamId = process.env.VERCEL_TEAM_ID;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!token || !teamId) {
  console.error("Missing VERCEL_TOKEN or VERCEL_TEAM_ID.");
  process.exit(1);
}
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}

const STANDARD_ENV_VARS = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", value: supabaseUrl },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: supabaseAnonKey },
];

const { values: args } = parseArgs({
  options: {
    repo: { type: "string" },
    name: { type: "string" },
    slug: { type: "string" },
    "prod-branch": { type: "string", default: "main" },
    "github-owner": { type: "string", default: process.env.GITHUB_OWNER ?? "" },
  },
});

if (!args.repo || !args.name || !args.slug) {
  console.error(
    "Usage: --repo <github-repo> --name <vercel-project-name> --slug <app-folder-under-apps/>",
  );
  process.exit(1);
}
if (!args["github-owner"]) {
  console.error("Missing --github-owner (or set GITHUB_OWNER in the environment).");
  process.exit(1);
}

const queryParams = `?teamId=${encodeURIComponent(teamId)}`;

async function vercel(path, init = {}) {
  const res = await fetch(`${VERCEL_API}${path}${queryParams}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vercel ${init.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
  }
  return res.json();
}

const repoFullName = `${args["github-owner"]}/${args.repo}`;
console.log(`Creating Vercel project '${args.name}' for ${repoFullName} (apps/${args.slug})…`);

const project = await vercel("/v10/projects", {
  method: "POST",
  body: JSON.stringify({
    name: args.name,
    framework: "nextjs",
    rootDirectory: `apps/${args.slug}`,
    gitRepository: {
      type: "github",
      repo: repoFullName,
      productionBranch: args["prod-branch"],
    },
  }),
});

console.log(`  ✓ Project ID: ${project.id}`);
console.log(`  ✓ Root Directory: apps/${args.slug}`);

for (const envVar of STANDARD_ENV_VARS) {
  await vercel(`/v10/projects/${project.id}/env`, {
    method: "POST",
    body: JSON.stringify({
      key: envVar.key,
      value: envVar.value,
      type: "plain",
      target: ["production", "preview", "development"],
    }),
  });
  console.log(`  ✓ Env var: ${envVar.key}`);
}

console.log(`\nDone. Expected URL once Vercel finishes the first build:`);
console.log(`  production (${args["prod-branch"]}): https://${args.name}.vercel.app`);
console.log(`\nStill manual: add GEMINI_API_KEY / GROQ_API_KEY in the Vercel dashboard if the app uses AI.`);
