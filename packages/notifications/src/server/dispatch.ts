// The fan-out the worker calls when a notification row is created.
//
// It owns the whole delivery decision: load the recipient's registrations,
// build one payload, push it down every transport, and prune the registrations
// the services report as dead. The transports are injectable so this is
// unit-testable without network or a database.

import type { NotificationRecord } from "../shared/types";
import { sendDevicePush } from "./device-push";
import type { DevicePushResult, DeviceTarget } from "./device-push";
import type { PushLogger } from "./log";
import { resolveVapidConfig, sendWebPush } from "./web-push";
import type {
  StoredSubscription,
  VapidConfig,
  WebPushResult,
} from "./web-push";

export type { PushLogger } from "./log";

export interface PushDispatchResult {
  device: DevicePushResult;
  web: WebPushResult;
}

export interface DispatchDeps {
  // Persistence, injected so tests avoid Prisma. The worker passes the
  // push-store helpers.
  listDeviceTokens: (userId: string) => Promise<DeviceTarget[]>;
  listSubscriptions: (userId: string) => Promise<StoredSubscription[]>;
  logger?: PushLogger;
  pruneDeviceTokens: (tokens: string[]) => Promise<void>;
  pruneSubscriptions: (endpoints: string[]) => Promise<void>;
  sendDevice?: typeof sendDevicePush;
  sendWeb?: typeof sendWebPush;
  vapid?: VapidConfig | null;
}

const NOOP_RESULT: PushDispatchResult = {
  device: { failed: 0, sent: 0, unregistered: [] },
  web: { expired: [], failed: 0, sent: 0 },
};

// A deployment with no FCM credential and no VAPID pair delivers nothing, but
// the per-call summary is indistinguishable from "this user has no devices".
// Warn once per process so a missing secret is immediately visible in the logs
// instead of looking like healthy zero-work.
let warnedUnconfigured = false;

// Delivers one notification to every registered endpoint for its recipient.
// Best-effort by contract: the caller (the unread-count job) must succeed even
// when push is down, so every failure here is logged and swallowed.
export async function dispatchNotificationPush(
  notification: NotificationRecord,
  deps: DispatchDeps
): Promise<PushDispatchResult> {
  const log = deps.logger;
  try {
    const [subscriptions, deviceTokens] = await Promise.all([
      deps.listSubscriptions(notification.recipientId),
      deps.listDeviceTokens(notification.recipientId),
    ]);
    if (subscriptions.length === 0 && deviceTokens.length === 0) {
      return NOOP_RESULT;
    }

    // `undefined` (omitted) means "resolve from env"; an explicit null means
    // the caller has already decided VAPID is unavailable. Using `??` here
    // would collapse both cases into "consult env", so an explicit null would
    // silently pick up a configured pair - and hide the unconfigured warning.
    const vapid = deps.vapid === undefined ? resolveVapidConfig() : deps.vapid;
    if (!vapid) {
      // Web push is off because VAPID is unset; a user with only browser
      // subscriptions silently receives nothing. Surface it once.
      logUnconfiguredOnce(log, "vapid");
    }
    const sendWeb = deps.sendWeb ?? sendWebPush;
    const sendDevice = deps.sendDevice ?? sendDevicePush;

    const [web, device] = await Promise.all([
      sendWeb(notification, subscriptions, { logger: log, vapid }),
      sendDevice(notification, deviceTokens, { logger: log }),
    ]);

    // Prune dead registrations so the next fan-out is smaller. Best-effort:
    // a prune failure must not fail the delivery that already succeeded.
    await Promise.all([
      deps.pruneSubscriptions(web.expired).catch((error: unknown) => {
        log?.warn("push.prune_subscriptions_failed", {
          error: String(error),
        });
      }),
      deps.pruneDeviceTokens(device.unregistered).catch((error: unknown) => {
        log?.warn("push.prune_device_tokens_failed", { error: String(error) });
      }),
    ]);

    log?.info("push.dispatched", {
      deviceFailed: device.failed,
      deviceSent: device.sent,
      recipientId: notification.recipientId,
      webFailed: web.failed,
      webSent: web.sent,
    });

    return { device, web };
  } catch (error) {
    log?.error("push.dispatch_failed", {
      error: String(error),
      recipientId: notification.recipientId,
    });
    return NOOP_RESULT;
  }
}

// True when at least one transport is configured. The worker checks this to
// skip the database reads entirely on deployments without any push setup.
export function isPushConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    resolveVapidConfig(env) !== null ||
    Boolean(env.FCM_SERVICE_ACCOUNT_JSON?.trim())
  );
}

// Emits the unconfigured warning at most once per process.
function logUnconfiguredOnce(
  log: PushLogger | undefined,
  missing: string
): void {
  if (warnedUnconfigured) {
    return;
  }
  warnedUnconfigured = true;
  log?.warn("push.transport_unconfigured", {
    missing,
    note: "push is disabled for this deployment; see .env.example",
  });
}

// Test-only: clears the once-per-process flag so a test can assert the warning
// deterministically rather than depending on execution order.
export function resetUnconfiguredWarningForTests(): void {
  warnedUnconfigured = false;
}
