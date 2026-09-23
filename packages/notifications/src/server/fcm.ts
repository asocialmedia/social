// Native push transport, direct to Firebase Cloud Messaging (HTTP v1).
//
// There is no third-party relay here: the worker holds a Google service
// account and authenticates straight to fcm.googleapis.com, so no Expo account
// or EAS project is involved. The app mints a raw FCM registration token with
// expo-notifications' getDevicePushTokenAsync and registers it with
// provider "fcm".
//
// Auth is a two-step OAuth2 flow: sign a short-lived JWT with the service
// account's private key, exchange it for an access token, then send. The
// access token is cached in-process until just before it expires, so a burst
// of notifications pays for one token.
//
// Android collapses same-collapseKey messages in the tray, mirroring web
// push's tag behavior; the `data.path` is what the app's tap handler reads.

import { SignJWT, importPKCS8 } from "jose";

import type { NotificationRecord } from "../shared/types";
import { describePushError } from "./log";
import type { PushLogger } from "./log";
import { buildPushPayload } from "./payload";

export const FCM_OAUTH_ENDPOINT = "https://oauth2.googleapis.com/token";
export const FCM_MESSAGING_SCOPE =
  "https://www.googleapis.com/auth/firebase.messaging";
const FCM_SEND_BASE = "https://fcm.googleapis.com/v1/projects";

// Refresh a little before real expiry so a token never expires mid-send.
const TOKEN_EXPIRY_SKEW_SECONDS = 60;
// The service-account JWT lifetime; Google rejects anything over an hour.
const ASSERTION_LIFETIME_SECONDS = 3600;

export interface FcmServiceAccount {
  clientEmail: string;
  // The PEM private key, exactly as Firebase hands it over (escaped newlines
  // are normalized by parseServiceAccount).
  privateKey: string;
  projectId: string;
}

export interface FcmTarget {
  platform: string;
  provider: string;
  token: string;
}

export interface FcmPushResult {
  failed: number;
  sent: number;
  // Tokens FCM reported as UNREGISTERED; the caller prunes these.
  unregistered: string[];
}

interface FcmErrorResponse {
  error?: {
    details?: { errorCode?: string }[];
    status?: string;
  };
}

// A FCM registration token is an opaque, long string. Any stored token that is
// clearly an Expo token belongs to the other transport, so it is skipped here
// rather than rejected by Google.
export function isFcmToken(token: string): boolean {
  return token.length > 0 && !token.startsWith("ExponentPushToken");
}

// Parses a service-account JSON blob (the file Firebase lets you download).
// Returns null when the shape is wrong, so a misconfigured deployment degrades
// to "push off" instead of throwing on the first notification.
export function parseServiceAccount(
  raw: string | null | undefined
): FcmServiceAccount | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as {
      client_email?: unknown;
      private_key?: unknown;
      project_id?: unknown;
    };
    const clientEmail = parsed.client_email;
    const privateKey = parsed.private_key;
    const projectId = parsed.project_id;
    if (
      typeof clientEmail !== "string" ||
      typeof privateKey !== "string" ||
      typeof projectId !== "string" ||
      !clientEmail ||
      !privateKey ||
      !projectId
    ) {
      return null;
    }
    // Firebase's downloaded JSON escapes newlines; a value pasted through a
    // shell/dotenv may arrive already unescaped. Normalize both to real PEM.
    return {
      clientEmail,
      privateKey: privateKey.includes("\\n")
        ? privateKey.replaceAll("\\n", "\n")
        : privateKey,
      projectId,
    };
  } catch {
    return null;
  }
}

export interface FcmAccessTokenCache {
  expiresAt: number;
  token: string;
}

// Resolves the service account from env, or null when push is unconfigured.
export function resolveFcmServiceAccount(
  env: NodeJS.ProcessEnv = process.env
): FcmServiceAccount | null {
  return parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON);
}

// Mints an OAuth2 access token for the messaging scope. `now` and `fetchImpl`
// are injectable for tests; the cache is passed in so the caller owns its
// lifetime.
export async function getFcmAccessToken(
  account: FcmServiceAccount,
  options: {
    cache?: FcmAccessTokenCache | null;
    fetchImpl?: typeof fetch;
    now?: () => number;
  } = {}
): Promise<FcmAccessTokenCache | null> {
  const now = options.now ?? Date.now;
  const nowSeconds = Math.floor(now() / 1000);

  if (
    options.cache &&
    options.cache.expiresAt - TOKEN_EXPIRY_SKEW_SECONDS > nowSeconds
  ) {
    return options.cache;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const key = await importPKCS8(account.privateKey, "RS256");
    const assertion = await new SignJWT({
      scope: FCM_MESSAGING_SCOPE,
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setAudience(FCM_OAUTH_ENDPOINT)
      .setIssuedAt(nowSeconds)
      .setIssuer(account.clientEmail)
      .setExpirationTime(nowSeconds + ASSERTION_LIFETIME_SECONDS)
      .sign(key);

    const response = await fetchImpl(FCM_OAUTH_ENDPOINT, {
      body: new URLSearchParams({
        assertion,
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof payload.access_token !== "string") {
      return null;
    }
    const expiresIn =
      typeof payload.expires_in === "number" ? payload.expires_in : 3600;
    const cache: FcmAccessTokenCache = {
      expiresAt: nowSeconds + expiresIn,
      token: payload.access_token,
    };
    return cache;
  } catch {
    return null;
  }
}

interface FcmMessage {
  android: {
    collapseKey: string;
    notification: { channelId: string; tag: string };
    priority: "HIGH";
  };
  data: Record<string, string>;
  notification: { body: string; title: string };
  token: string;
}

// FCM's `data` payload is string-to-string only.
export function buildFcmMessage(
  notification: NotificationRecord,
  token: string
): FcmMessage {
  const payload = buildPushPayload(notification);
  return {
    android: {
      collapseKey: payload.tag,
      notification: { channelId: "default", tag: payload.tag },
      priority: "HIGH",
    },
    data: { notificationId: notification.id, path: payload.path },
    notification: { body: payload.body, title: payload.title },
    token,
  };
}

// FCM returns 404 (or UNREGISTERED) for a token it no longer knows: the app was
// uninstalled or the token rotated. Only that is a safe prune signal.
//
// INVALID_ARGUMENT (400) is deliberately NOT treated as unregistered even though
// a malformed token can produce it: the same status also covers payload-level
// errors. A bug in buildFcmMessage would then make every send return 400 and
// prune every user's token in one pass - a silent, fleet-wide outage that each
// user could only fix by reinstalling. A dead token merely wastes one request
// until FCM reports it properly, so the conservative reading is the correct one.
function isUnregistered(status: number, body: FcmErrorResponse): boolean {
  if (status === 404) {
    return true;
  }
  const codes = body.error?.details?.map((entry) => entry.errorCode) ?? [];
  return codes.includes("UNREGISTERED") || body.error?.status === "NOT_FOUND";
}

export interface SendFcmOptions {
  cache?: FcmAccessTokenCache | null;
  fetchImpl?: typeof fetch;
  logger?: PushLogger;
  now?: () => number;
  serviceAccount: FcmServiceAccount | null;
}

// `detail` carries the status/reason so the caller can log WHY a send failed;
// the counts alone cannot distinguish an expired credential from a rate limit.
type FcmSendOutcome =
  | { kind: "failed"; detail: { reason: string; status: number | null } }
  | { kind: "sent" }
  | { kind: "unregistered" };

// One message, one HTTP call. Extracted so the send loop below has a single
// awaited call per iteration and the try/catch stays off the loop body.
async function sendFcmMessage(
  endpoint: string,
  accessToken: string,
  notification: NotificationRecord,
  token: string,
  fetchImpl: typeof fetch
): Promise<FcmSendOutcome> {
  try {
    const response = await fetchImpl(endpoint, {
      body: JSON.stringify({ message: buildFcmMessage(notification, token) }),
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    if (response.ok) {
      return { kind: "sent" };
    }
    const body = (await response.json().catch(() => ({}))) as FcmErrorResponse;
    if (isUnregistered(response.status, body)) {
      return { kind: "unregistered" };
    }
    const codes = body.error?.details?.map((entry) => entry.errorCode) ?? [];
    return {
      detail: {
        reason: body.error?.status ?? codes.join(",") ?? "unknown",
        status: response.status,
      },
      kind: "failed",
    };
  } catch (error) {
    return { detail: describePushError(error), kind: "failed" };
  }
}

// Delivers one notification to a user's FCM devices. Never throws: a transport
// failure is counted so the worker job cannot be poisoned by a push outage.
// Sends sequentially because each message is a separate HTTP call and a user
// holds few devices; the access token is fetched once for the whole batch.
export async function sendFcmPush(
  notification: NotificationRecord,
  targets: FcmTarget[],
  options: SendFcmOptions
): Promise<FcmPushResult> {
  const result: FcmPushResult = { failed: 0, sent: 0, unregistered: [] };
  const deliverable = targets.filter(
    (target) => target.provider === "fcm" && isFcmToken(target.token)
  );
  if (deliverable.length === 0 || !options.serviceAccount) {
    return result;
  }

  const auth = await getFcmAccessToken(options.serviceAccount, {
    cache: options.cache,
    fetchImpl: options.fetchImpl,
    now: options.now,
  });
  if (!auth) {
    // The credential is unusable (bad PEM, revoked key, Google unreachable).
    // Every device fails identically, so log once rather than per device.
    result.failed = deliverable.length;
    options.logger?.error("push.fcm_auth_failed", {
      devices: deliverable.length,
      projectId: options.serviceAccount.projectId,
    });
    return result;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${FCM_SEND_BASE}/${encodeURIComponent(options.serviceAccount.projectId)}/messages:send`;

  for (const target of deliverable) {
    // oxlint-disable-next-line no-await-in-loop -- one HTTP request per message, and FCM rate-limits per project, so a bounded serial loop keeps the worker's concurrency budget predictable
    const outcome = await sendFcmMessage(
      endpoint,
      auth.token,
      notification,
      target.token,
      fetchImpl
    );
    if (outcome.kind === "sent") {
      result.sent += 1;
    } else if (outcome.kind === "unregistered") {
      result.unregistered.push(target.token);
    } else {
      result.failed += 1;
      // No token in the log: it is a capability to push to that device.
      options.logger?.warn("push.fcm_send_failed", {
        platform: target.platform,
        reason: outcome.detail.reason,
        status: outcome.detail.status,
      });
    }
  }

  return result;
}
