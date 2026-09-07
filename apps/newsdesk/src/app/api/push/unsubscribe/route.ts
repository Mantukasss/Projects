import { NextResponse } from "next/server";
import { hasPushBackend, unsubscribe } from "@/lib/push";

export const runtime = "nodejs";

/** Forgets a browser. Turning your own alerts off must always work. */
export async function POST(request: Request) {
  if (!hasPushBackend()) {
    return NextResponse.json({ error: "push backend not configured" }, { status: 501 });
  }
  let endpoint = "";
  try {
    endpoint = String(((await request.json()) as { endpoint?: string }).endpoint ?? "");
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });

  try {
    await unsubscribe(endpoint);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "could not remove" },
      { status: 502 },
    );
  }
}
