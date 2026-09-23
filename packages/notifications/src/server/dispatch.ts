// The fan-out the worker calls when a notification row is created.
//
// It owns the whole delivery decision: load the recipient's registrations,
// build one payload, push it down every transport, and prune the registrations
// the services report as dead. The transports are injectable so this is
// unit-testable without network or a database.

import type { NotificationRecord } from "../shared/types";
import { sendDevicePush } from "./device-push";
import type { DevicePushResult, DeviceTarget } from "./device-push";
import { resolveVapidConfig, sendWebPush } from "./web-push";
import type {
  StoredSubscription,
  VapidConfig,
  WebPushResult,
} from "./web-push";

export interface PushLogger {
  error: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

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

    const vapid = deps.vapid ?? resolveVapidConfig();
    const sendWeb = deps.sendWeb ?? sendWebPush;
    const sendDevice = deps.sendDevice ?? sendDevicePush;

    const [web, device] = await Promise.all([
      sendWeb(notification, subscriptions, { vapid }),
      sendDevice(notification, deviceTokens),
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
