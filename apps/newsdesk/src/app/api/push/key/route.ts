import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The VAPID public key, served rather than inlined.
 *
 * It could be a NEXT_PUBLIC_ variable, but those are baked in at build time, and in this repo
 * an env-var change alone CANNOT be deployed — redeploying the same commit makes
 * scripts/vercel-ignore.sh compare it against itself, find no diff and cancel the build. A
 * route reads the variable at request time, so rotating the key needs no deploy at all.
 */
export function GET() {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return NextResponse.json({ error: "push not configured" }, { status: 501 });
  }
  return NextResponse.json({ key });
}
