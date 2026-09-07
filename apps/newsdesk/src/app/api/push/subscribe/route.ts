import { NextResponse } from "next/server";
import { hasPushBackend, subscribe } from "@/lib/push";

export const runtime = "nodejs";

/**
 * Registers a browser for alerts.
 *
 * The body is whatever `PushManager.subscribe()` returned. The endpoint is issued by the
 * push service — Google's, Apple's, Mozilla's — not chosen by the caller, which is why the
 * underlying function is safe to expose to anon: you can only register a device the push
 * service already vouched for, and registering your own device is the entire point.
 */
export async function POST(request: Request) {
  if (!hasPushBackend()) {
    return NextResponse.json({ error: "push backend not configured" }, { status: 501 });
  }

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const endpoint = String(body.endpoint ?? "");
  const p256dh = String(body.keys?.p256dh ?? "");
  const auth = String(body.keys?.auth ?? "");
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "incomplete subscription" }, { status: 400 });
  }

  try {
    await subscribe({ endpoint, p256dh, auth });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "could not save" },
      { status: 502 },
    );
  }
}
