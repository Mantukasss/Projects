"use client";

import { useEffect, useState } from "react";
import { IconBell, IconBellOff, IconBellRinging } from "@tabler/icons-react";

/**
 * Turns push alerts on for this device.
 *
 * WHY THIS EXISTS: the feed is pull-based, so a story announced at 13:35 sits unread until
 * someone opens the app. On the day that prompted this, an org announced a contract renewal
 * and the story was public for eleven minutes before the fastest account in the niche posted
 * it. Being first is worth nothing if nobody is looking.
 *
 * PER DEVICE, not per account — there is no account. A push subscription belongs to one
 * browser on one device, so turning this on here says nothing about any other phone.
 */

/**
 * The VAPID key arrives as base64url and the browser wants raw bytes.
 *
 * Not decoration: `applicationServerKey` throws on a string in most browsers, and the error
 * it throws ("InvalidCharacterError") says nothing about keys at all.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

type State = "unsupported" | "needs-install" | "off" | "on" | "denied" | "working";

export default function PushToggle() {
  const [state, setState] = useState<State>("working");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const supported = "serviceWorker" in navigator && "PushManager" in window;
    if (!supported) {
      /**
       * On iOS, Web Push exists ONLY inside a home-screen app, and Safari hides PushManager
       * entirely in a browser tab. That is not a bug to work around and it is not something
       * the page can ask for: the user has to Share -> Add to Home Screen first. Saying so
       * beats a button that does nothing.
       */
      const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as { standalone?: boolean }).standalone === true;
      setState(iOS && !standalone ? "needs-install" : "unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setState(subscription ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  const enable = async () => {
    setState("working");
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const { key } = await (await fetch("/api/push/key")).json();
      if (!key) throw new Error("no key on the server");

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // Required, and required to be true: a push that shows nothing is a silent push, and
        // browsers revoke the permission of apps that send them.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "could not register");

      setState("on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not turn alerts on");
      setState("off");
    }
  };

  const disable = async () => {
    setState("working");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // Tell the server first: a device that unsubscribes locally but stays in the table
        // costs a failed request on every tick until it ages out.
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setState("on");
    }
  };

  if (state === "needs-install") {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-text-muted">
        Alerts need the app on your home screen — iOS only allows them there. Share → Add to
        Home Screen, open it from the icon, then turn them on.
      </p>
    );
  }
  if (state === "unsupported") {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-text-low">
        This browser cannot do push alerts.
      </p>
    );
  }
  if (state === "denied") {
    return (
      <p className="rounded-md border border-coral/40 px-3 py-2 text-xs text-coral">
        Alerts are blocked for this site. Turn notifications back on in your browser settings,
        then reload.
      </p>
    );
  }

  return (
    <div>
      <button
        onClick={state === "on" ? disable : enable}
        disabled={state === "working"}
        className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-md border px-3 text-sm transition-colors duration-150 ease-out disabled:opacity-50 ${
          state === "on" ? "border-teal text-teal" : "border-border text-text-muted"
        }`}
      >
        {state === "on" ? (
          <IconBellRinging size={18} stroke={1.5} />
        ) : state === "working" ? (
          <IconBell size={18} stroke={1.5} />
        ) : (
          <IconBellOff size={18} stroke={1.5} />
        )}
        {state === "on"
          ? "Alerts on — tap to turn off"
          : state === "working"
            ? "…"
            : "Alert me when something breaks"}
      </button>
      {state === "on" && (
        <p className="mt-1 text-[11px] text-text-low">
          Only for stories worth being first on, at most two at a time. This device only.
        </p>
      )}
      {error && <p className="mt-1 text-xs text-coral">{error}</p>}
    </div>
  );
}
