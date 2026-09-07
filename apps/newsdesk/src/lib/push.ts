/**
 * Talking to the push tables, which nothing else may touch.
 *
 * Every table in the `newsdesk` schema has RLS on and NO POLICY, so the anon key can read and
 * write nothing directly — verified: a plain select on any of them is refused. The only way
 * in is the SECURITY DEFINER functions, and the two privileged ones demand a shared secret.
 * That is why this app never needs the service_role key, which stays in the owner's password
 * manager per the repo rule and never reaches Vercel.
 *
 * THE FUNCTIONS LIVE IN `public`, THE TABLES IN `newsdesk`, and that split is deliberate.
 * PostgREST only serves schemas it has been configured to expose, and adding one takes a
 * service restart on Supabase; `public` is already exposed. Four narrow, secret-guarded
 * functions there is a smaller API surface than a whole extra schema, and it needed no
 * config change at all. See supabase/003_push_public_api.sql.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function hasPushBackend(): boolean {
  return Boolean(SUPABASE_URL && ANON_KEY);
}

export function hasPushKeys(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** Calls one of the schema's functions through PostgREST. */
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`${name} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function subscribe(sub: StoredSubscription): Promise<void> {
  return rpc("newsdesk_subscribe_push", {
    p_endpoint: sub.endpoint,
    p_p256dh: sub.p256dh,
    p_auth: sub.auth,
  });
}

export function unsubscribe(endpoint: string): Promise<void> {
  return rpc("newsdesk_unsubscribe_push", { p_endpoint: endpoint });
}

/**
 * Claims a batch of stories and returns the ones nobody has pushed yet, with the devices.
 *
 * The claim IS the insert — `on conflict do nothing ... returning` — so two dispatches racing
 * each other cannot both win the same story. On a one-minute timer that overlap is a matter
 * of when, not if, and a read-then-write would have pushed twice every time it happened.
 */
export function claim(
  secret: string,
  itemIds: string[],
): Promise<{ new_ids: string[]; subscriptions: StoredSubscription[] }> {
  return rpc("newsdesk_claim_push", { p_secret: secret, p_item_ids: itemIds });
}

export function recordResult(
  secret: string,
  endpoint: string,
  ok: boolean,
  gone: boolean,
): Promise<void> {
  return rpc("newsdesk_record_push_result", {
    p_secret: secret,
    p_endpoint: endpoint,
    p_ok: ok,
    p_gone: gone,
  });
}
