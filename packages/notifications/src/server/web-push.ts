// Web push transport. Wraps web-push so the rest of the codebase deals in
// notification rows and plain payloads, not VAPID keys and subscription
// objects.
//
// Configuration is env-only and optional: when VAPID keys are absent the
// sender reports `configured: false` and every send is a no-op. That keeps dev
// and self-hosted deployments without push keys fully working instead of
// throwing on every notification.

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

// Delivers one notification to a set of browser subscriptions. Never throws:
// a dead endpoint is collected for pruning and any other failure is counted, so
// one bad subscription cannot abort the rest or the worker job.
const SEND_TIMEOUT_MS = 10_000;
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

  for (const subscription of subscriptions.slice(
    0,
    MAX_SUBSCRIPTIONS_PER_USER
  )) {
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
      continue;
    }
    try {
      // Sequential on purpose: push services rate-limit per connection and a
      // user holds few subscriptions, so a bounded serial loop keeps the
      // worker's concurrency budget predictable.
      // eslint-disable-next-line no-await-in-loop -- bounded serial delivery, see note above
      await send(toWebPushSubscription(subscription), body);
      result.sent += 1;
    } catch (error) {
      if (isGone(error)) {
        result.expired.push(subscription.endpoint);
      } else {
        result.failed += 1;
        const detail = describePushError(error);
        // Host only: the full endpoint is a capability to push to that device.
        options.logger?.warn("push.web_send_failed", {
          host: endpointHost(subscription.endpoint),
          reason: detail.reason,
          status: detail.status,
        });
      }
    }
  }

  return result;
}
