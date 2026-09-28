// Web push transport. Wraps web-push so the rest of the codebase deals in
// notification rows and plain payloads, not VAPID keys and subscription
// objects.
//
// Configuration is env-only and optional: when VAPID keys are absent the
// sender reports `configured: false` and every send is a no-op. That keeps dev
// and self-hosted deployments without push keys fully working instead of
// throwing on every notification.

import { setTimeout as sleep } from "node:timers/promises";

import type { PushSubscription } from "web-push";
import webpush from "web-push";

import { isAllowedPushEndpoint } from "../shared/push-endpoint";
import type { NotificationRecord } from "../shared/types";
import { describePushError, endpointHost } from "./log";
import type { PushLogger } from "./log";
import { buildPushPayload } from "./payload";
import type { PushPayload } from "./payload";

export interface VapidConfig {
  privateKey: string;
  publicKey: string;
  subject: string;
}

const DEFAULT_SUBJECT = "mailto:hello@asocialmedia.cc";

// Resolves the VAPID config from env, or null when push is not configured.
// Accepts the conventional VAPID_* names; the public key is safe to ship to
// the client and is served by GET /api/push/public-key.
export function resolveVapidConfig(
  env: NodeJS.ProcessEnv = process.env
): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) {
    return null;
  }
  return {
    privateKey,
    publicKey,
    subject: env.VAPID_SUBJECT?.trim() || DEFAULT_SUBJECT,
  };
}

export interface StoredSubscription {
  auth: string;
  endpoint: string;
  p256dh: string;
}

export interface WebPushResult {
  // Endpoints the push service reported as gone; the caller prunes these.
  expired: string[];
  failed: number;
  sent: number;
}

export interface SendWebPushOptions {
  logger?: PushLogger;
  // Injectable for tests; defaults to web-push.
  sendNotification?: (
    subscription: PushSubscription,
    payload: string
  ) => Promise<unknown>;
  vapid: VapidConfig | null;
}

function toWebPushSubscription(sub: StoredSubscription): PushSubscription {
  return {
    endpoint: sub.endpoint,
    keys: { auth: sub.auth, p256dh: sub.p256dh },
  };
}

// A push service answering 404/410 means the subscription is permanently gone.
function isGone(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const status = (error as { statusCode?: unknown }).statusCode;
  return status === 404 || status === 410;
}

function isRetryable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return true;
  }
  const status = (error as { statusCode?: unknown }).statusCode;
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    typeof status !== "number" ||
    status >= 500
  );
}

type WebSendOutcome =
  | { kind: "sent" }
  | { kind: "gone" }
  | { kind: "failed"; error: unknown };

const WEB_SEND_MAX_ATTEMPTS = 2;
const WEB_SEND_RETRY_BASE_MS = 250;

async function sendWithRetry(
  send: () => Promise<unknown>,
  attempt = 1
): Promise<WebSendOutcome> {
  try {
    await send();
    return { kind: "sent" };
  } catch (error) {
    if (isGone(error)) {
      return { kind: "gone" };
    }
    if (!isRetryable(error) || attempt >= WEB_SEND_MAX_ATTEMPTS) {
      return { error, kind: "failed" };
    }
    await sleep(WEB_SEND_RETRY_BASE_MS * 2 ** (attempt - 1));
    return await sendWithRetry(send, attempt + 1);
  }
}

// Delivers one notification to a set of browser subscriptions. Never throws:
// a dead endpoint is collected for pruning and any other failure is counted, so
// one bad subscription cannot abort the rest or the worker job.
const SEND_TIMEOUT_MS = 5000;
const PUSH_BATCH_BUDGET_MS = 30_000;
// A user holds a handful of browsers; the cap keeps one account with a
// flood of registrations from monopolising the worker.
const MAX_SUBSCRIPTIONS_PER_USER = 20;

export async function sendWebPush(
  notification: NotificationRecord,
  subscriptions: StoredSubscription[],
  options: SendWebPushOptions
): Promise<WebPushResult> {
  const result: WebPushResult = { expired: [], failed: 0, sent: 0 };
  if (!options.vapid || subscriptions.length === 0) {
    return result;
  }

  const payload: PushPayload = buildPushPayload(notification);
  const body = JSON.stringify(payload);
  const send =
    options.sendNotification ??
    ((subscription: PushSubscription, data: string) =>
      webpush.sendNotification(subscription, data, {
        TTL: 24 * 60 * 60,
        // A hung push service must not hold the worker slot.
        timeout: SEND_TIMEOUT_MS,
        vapidDetails: options.vapid ?? undefined,
      }));

  const deliverable = subscriptions.slice(0, MAX_SUBSCRIPTIONS_PER_USER);
  const deadline = Date.now() + PUSH_BATCH_BUDGET_MS;
  const sendNext = async (index: number): Promise<void> => {
    if (index >= deliverable.length) {
      return;
    }
    const subscription = deliverable[index];
    if (subscription && Date.now() >= deadline) {
      result.failed += deliverable.length - index;
      options.logger?.warn("push.web_batch_budget_exhausted", {
        remaining: deliverable.length - index,
      });
      return;
    }
    if (!subscription) {
      return;
    }
    // Defense in depth against SSRF: the subscribe route already refuses
    // non push-service endpoints, and anything stored before that check (or
    // written some other way) is never contacted and gets pruned.
    if (!isAllowedPushEndpoint(subscription.endpoint)) {
      result.expired.push(subscription.endpoint);
      // A non-push-service endpoint is never contacted; log the host so a bad
      // row is traceable without writing the endpoint itself.
      options.logger?.warn("push.web_endpoint_rejected", {
        host: endpointHost(subscription.endpoint),
      });
      await sendNext(index + 1);
      return;
    }
    const outcome = await sendWithRetry(() =>
      send(toWebPushSubscription(subscription), body)
    );
    if (outcome.kind === "sent") {
      result.sent += 1;
    } else if (outcome.kind === "gone") {
      result.expired.push(subscription.endpoint);
    } else {
      result.failed += 1;
      const detail = describePushError(outcome.error);
      options.logger?.warn("push.web_send_failed", {
        host: endpointHost(subscription.endpoint),
        reason: detail.reason,
        status: detail.status,
      });
    }
    await sendNext(index + 1);
  };

  await sendNext(0);

  return result;
}
