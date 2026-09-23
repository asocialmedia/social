// Native push transport, via Expo's push service.
//
// The app registers an Expo push token (ExponentPushToken[...]) through
// expo-notifications and stores it as a DevicePushToken. Expo's HTTP API
// accepts a batch of messages and reports per-message delivery status, so this
// sender batches all of a user's devices into one request and parses the
// receipts for the tokens Expo says are unregistered.
//
// Raw FCM/APNs would slot in beside this: `provider` on the stored token
// distinguishes them, and this module is the only place that knows the
// transport.

import type { NotificationRecord } from "../shared/types";
import { buildPushPayload } from "./payload";

export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

export interface ExpoPushMessage {
  body: string;
  // Android collapses same-tag notifications in the tray; iOS uses it as the
  // thread identifier so a post's notifications stack together.
  collapseId?: string;
  data: Record<string, unknown>;
  sound: "default";
  title: string;
  to: string;
}

export interface DeviceTarget {
  platform: string;
  provider: string;
  token: string;
}

export interface DevicePushResult {
  failed: number;
  // Tokens Expo reported as DeviceNotRegistered; the caller prunes these.
  unregistered: string[];
  sent: number;
}

interface ExpoTicket {
  details?: { error?: string };
  id?: string;
  status?: "error" | "ok";
}

interface ExpoResponse {
  data?: ExpoTicket | ExpoTicket[];
}

// An Expo token always looks like ExponentPushToken[xxxx] (or the legacy
// ExponentPushToken). Anything else is a raw FCM/APNs token this transport
// cannot address, so it is skipped rather than sent to Expo and rejected.
export function isExpoPushToken(token: string): boolean {
  return /^(?:ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token);
}

// Builds the wire message for one device. The `data.path` is what the app's
// tap handler reads to deep-link; `tag` collapses repeats.
export function buildExpoMessage(
  notification: NotificationRecord,
  token: string
): ExpoPushMessage {
  const payload = buildPushPayload(notification);
  return {
    body: payload.body,
    collapseId: payload.tag,
    data: { notificationId: notification.id, path: payload.path },
    sound: "default",
    title: payload.title,
    to: token,
  };
}

function ticketsFrom(response: ExpoResponse): ExpoTicket[] {
  if (Array.isArray(response.data)) {
    return response.data;
  }
  return response.data ? [response.data] : [];
}

export interface SendDevicePushOptions {
  // Injectable for tests; defaults to global fetch.
  fetchImpl?: typeof fetch;
}

/**
 * Delivers one notification to a user's native devices. Never throws: a
 * transport failure is counted so the worker job cannot be poisoned by a push
 * outage.
 */
export async function sendDevicePush(
  notification: NotificationRecord,
  targets: DeviceTarget[],
  options: SendDevicePushOptions = {}
): Promise<DevicePushResult> {
  const result: DevicePushResult = { failed: 0, sent: 0, unregistered: [] };
  const deliverable = targets.filter(
    (target) => target.provider === "expo" && isExpoPushToken(target.token)
  );
  if (deliverable.length === 0) {
    return result;
  }

  const messages = deliverable.map((target) =>
    buildExpoMessage(notification, target.token)
  );
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(EXPO_PUSH_ENDPOINT, {
      body: JSON.stringify(messages),
      headers: {
        accept: "application/json",
        "accept-encoding": "gzip, deflate",
        "content-type": "application/json",
      },
      method: "POST",
    });
    if (!response.ok) {
      result.failed = deliverable.length;
      return result;
    }
    const tickets = ticketsFrom((await response.json()) as ExpoResponse);
    for (const [index, target] of deliverable.entries()) {
      const ticket = tickets[index];
      if (!ticket || ticket.status === "error") {
        if (ticket?.details?.error === "DeviceNotRegistered") {
          result.unregistered.push(target.token);
        } else {
          result.failed += 1;
        }
        continue;
      }
      result.sent += 1;
    }
  } catch {
    result.failed = deliverable.length;
  }

  return result;
}
