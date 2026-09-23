"use client";
// Browser push registration for the web app.
//
// Two concerns kept separate on purpose:
// - `pushSupported()` answers whether this browser can do push at all;
// - `ensurePushServiceWorker()` registers /sw.js once and waits for it to be
//   active, so subscribe() can never race an unregistered worker.
//
// The VAPID key is fetched from the server (GET /api/push/public-key), because
// it must match the private key the worker signs with; a hardcoded key would
// silently stop working after a key rotation.

export type PushSupport =
  | { reason: "denied" | "insecure" | "unsupported"; supported: false }
  | { supported: true };

export function pushSupported(): PushSupport {
  if (typeof window === "undefined") {
    return { reason: "unsupported", supported: false };
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { reason: "unsupported", supported: false };
  }
  // Push requires a secure context; localhost is exempt per the spec.
  if (!window.isSecureContext) {
    return { reason: "insecure", supported: false };
  }
  if (Notification.permission === "denied") {
    return { reason: "denied", supported: false };
  }
  return { supported: true };
}

// Converts the base64url VAPID key into the Uint8Array applicationServerKey
// wants. The key is not necessarily padded, so pad it before atob. The buffer
// is allocated explicitly so its type is ArrayBuffer (not ArrayBufferLike),
// which the PushManager type rejects.
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding)
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const raw = atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (const [index, character] of [...raw].entries()) {
    output[index] = character.codePointAt(0) ?? 0;
  }
  return output;
}

let cachedRegistration: ServiceWorkerRegistration | null = null;

/**
 * Registers /sw.js once and resolves with an ACTIVE registration, so
 * PushManager.subscribe always has a worker to live on. A failed registration
 * is not cached, so a later call can retry.
 */
export async function ensurePushServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (cachedRegistration?.active) {
    return cachedRegistration;
  }
  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
  });
  if (registration.active) {
    cachedRegistration = registration;
    return registration;
  }
  // A fresh registration has no active worker until it installs and activates.
  // `serviceWorker.ready` is the native signal for exactly that; it never
  // requires a client reload the way a raw statechange wait would.
  const active = await navigator.serviceWorker.ready;
  cachedRegistration = active;
  return active;
}

async function fetchVapidKey(signal?: AbortSignal): Promise<string | null> {
  const response = await fetch("/api/push/public-key", { signal });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as {
    configured?: boolean;
    publicKey?: string | null;
  };
  return data.configured && data.publicKey ? data.publicKey : null;
}

async function postSubscription(
  method: "subscribe" | "unsubscribe",
  body: unknown
): Promise<boolean> {
  const response = await fetch(`/api/push/${method}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return response.ok;
}

/**
 * Requests permission, subscribes the browser and registers the subscription
 * with the server. Returns false (never throws) so the settings toggle can
 * revert cleanly on any failure: unsupported browser, denied permission, a
 * missing VAPID key, or a rejected request.
 */
export async function enableWebPush(): Promise<boolean> {
  const support = pushSupported();
  if (!support.supported) {
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return false;
    }
    const key = await fetchVapidKey();
    if (!key) {
      return false;
    }
    const registration = await ensurePushServiceWorker();
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        applicationServerKey: urlBase64ToUint8Array(key),
        userVisibleOnly: true,
      }));
    return await postSubscription("subscribe", subscription.toJSON());
  } catch {
    return false;
  }
}

/** Unsubscribes the browser and removes the server row. Best-effort. */
export async function disableWebPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) {
      return true;
    }
    const removed = await postSubscription("unsubscribe", {
      endpoint: subscription.endpoint,
    });
    await subscription.unsubscribe();
    return removed;
  } catch {
    return false;
  }
}

/** Whether this browser currently holds an active push subscription. */
export async function hasActivePushSubscription(): Promise<boolean> {
  if (!pushSupported().supported) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    return Boolean(subscription);
  } catch {
    return false;
  }
}
