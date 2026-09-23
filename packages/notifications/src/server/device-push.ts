// Native push transport, direct to Firebase Cloud Messaging (FCM).
//
// There is no third-party relay: this app runs its own worker, which holds a
// Google service account and authenticates straight to fcm.googleapis.com. No
// Expo account or EAS project is involved.
//
// Android push IS Firebase - there is no alternative transport - so the one
// non-negotiable piece of setup is Firebase: `google-services.json` in the app
// build (so the device can mint a registration token) and a service-account
// key on the server (so the worker can send). See ./fcm.ts for the sender.

import type { NotificationRecord } from "../shared/types";
import type { FcmAccessTokenCache } from "./fcm";
import { resolveFcmServiceAccount, sendFcmPush } from "./fcm";
import type { PushLogger } from "./log";

export {
  buildFcmMessage,
  getFcmAccessToken,
  isFcmToken,
  parseServiceAccount,
  resolveFcmServiceAccount,
  sendFcmPush,
} from "./fcm";
export type {
  FcmAccessTokenCache,
  FcmPushResult,
  FcmServiceAccount,
  FcmTarget,
} from "./fcm";

export interface DeviceTarget {
  platform: string;
  provider: string;
  token: string;
}

export interface DevicePushResult {
  failed: number;
  sent: number;
  // Tokens FCM reported as gone; the caller prunes these.
  unregistered: string[];
}

export interface SendDevicePushOptions {
  // Process-wide access-token cache, owned by the caller so it survives
  // between notifications.
  cache?: FcmAccessTokenCache | null;
  fetchImpl?: typeof fetch;
  logger?: PushLogger;
  now?: () => number;
}

// Delivers one notification to a user's native devices. Never throws: a
// transport failure is counted so the worker job cannot be poisoned by a push
// outage.
export async function sendDevicePush(
  notification: NotificationRecord,
  targets: DeviceTarget[],
  options: SendDevicePushOptions = {}
): Promise<DevicePushResult> {
  if (targets.length === 0) {
    return { failed: 0, sent: 0, unregistered: [] };
  }
  return await sendFcmPush(notification, targets, {
    cache: options.cache,
    fetchImpl: options.fetchImpl,
    logger: options.logger,
    now: options.now,
    serviceAccount: resolveFcmServiceAccountCached(),
  });
}

// Env is read per call rather than at module load so a test (or a late env
// injection) sees the current value, but the parsed account is memoized by the
// raw JSON string so repeated sends do not re-parse the PEM.
let cachedRaw: string | null | undefined;
let cachedAccount: ReturnType<typeof resolveFcmServiceAccount> | null = null;

function resolveFcmServiceAccountCached() {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON ?? null;
  if (cachedRaw !== raw) {
    cachedRaw = raw;
    cachedAccount = resolveFcmServiceAccount();
  }
  return cachedAccount;
}

// True when native push is configured. The worker checks this to skip the
// database reads entirely on deployments without a service account.
export function isDevicePushConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(env.FCM_SERVICE_ACCOUNT_JSON?.trim());
}
