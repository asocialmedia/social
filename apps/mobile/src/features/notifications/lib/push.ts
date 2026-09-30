// Native push registration: obtains a raw FCM registration token and
// registers it with the API, then keeps it fresh and routes taps.
//
// No Expo relay and no EAS project id: this app runs its own worker, which
// talks to Firebase directly (see @asm/notifications/server). That also means
// no third party holds the delivery credentials.
//
// Every step is best-effort and gated so the app works unchanged without push
// configuration:
// - Android needs google-services.json (Firebase) in the build, so
//   getDevicePushTokenAsync fails on a build without it; registration is
//   skipped rather than throwing.
// - Permission is requested once, lazily, after sign-in; a denial just leaves
//   the device unregistered.
// - The endpoint is install-token and session gated server-side, so a fresh
//   install that fails either check simply retries on the next foreground.
//
// Tap routing: a notification carries `data.path` (a web path such as
// /posts/abcd1234). Post paths map onto the native detail screen; everything
// else resolves to the notifications list, which always exists.

import Constants from "expo-constants";
import type * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { withAuthHeaders } from "@/lib/auth-headers";
import { logInfo, logWarn } from "@/lib/telemetry";

import { pathToNativeRoute } from "./push-path";

export { pathToNativeRoute } from "./push-path";

const ANDROID_CHANNEL_ID = "default";

// Foreground presentation: show the banner and play sound even while the app
// is open, so live notifications alert visibly and audibly.
type NotificationsModule = typeof Notifications;
let notificationsPromise: Promise<NotificationsModule> | null = null;

function loadNotifications(): Promise<NotificationsModule> | null {
  if (Platform.OS === "web" || Constants.expoGoConfig !== null) {
    return null;
  }
  notificationsPromise ??= (async () => {
    const notifications = await import("expo-notifications");
    notifications.setNotificationHandler({
      handleNotification: () =>
        Promise.resolve({
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
    });
    return notifications;
  })();
  return notificationsPromise;
}

async function ensureAndroidChannel(): Promise<void> {
  const notifications = await loadNotifications();
  if (Platform.OS !== "android" || !notifications) {
    return;
  }
  await notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    enableLights: true,
    enableVibrate: true,
    importance: notifications.AndroidImportance.MAX,
    lightColor: "#ff9500",
    name: "Notifications",
    showBadge: true,
    vibrationPattern: [0, 250, 250, 250],
  });
}

// The push routes authenticate with the session cookie and bearer token like every
// other API route, scoping device tokens to the authenticated user.
async function sessionHeaders(): Promise<Record<string, string>> {
  const cookie = await authClient.getCookie();
  return withAuthHeaders({ "Content-Type": "application/json" }, cookie);
}

export type RunWithInstallToken = <T>(
  action: () => Promise<T>,
  isTokenRejected: (result: T) => boolean
) => Promise<T | null>;

type DeviceTokenRegistration =
  | "registered"
  | "install-token-required"
  | "failed";

async function postToken(
  token: string,
  platform: "android" | "ios"
): Promise<DeviceTokenRegistration> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/push/device`, {
      body: JSON.stringify({ platform, provider: "fcm", token }),
      headers: await sessionHeaders(),
      method: "POST",
    });
    if (response.ok) {
      return "registered";
    }
    if (response.status === 403) {
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      if (body?.error === "install-token-required") {
        return "install-token-required";
      }
    }
    logWarn("push.device_register_rejected", {
      status: response.status,
    });
    return "failed";
  } catch (error) {
    logWarn("push.device_register_failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  }
}

async function unregisterToken(token: string): Promise<void> {
  try {
    await fetch(`${getApiBaseUrl()}/api/push/device`, {
      body: JSON.stringify({ token }),
      headers: await sessionHeaders(),
      method: "DELETE",
    });
  } catch {
    // Best-effort; a stale token is pruned server-side on delivery failure.
  }
}

let lastRegisteredToken: string | null = null;

// Requests permission and registers this device. Safe to call repeatedly:
// a token already registered this session is not re-sent. Returns the token,
// or null when push is unavailable (no permission, simulator, no Firebase
// config in the build). Reasons are logged distinctly so diagnostics can tell
// "Expo Go" apart from "emulator" apart from "no Firebase in this build".
export async function registerForPushNotifications(
  runWithInstallToken: RunWithInstallToken
): Promise<string | null> {
  if (Platform.OS !== "android") {
    // Only Android is wired: the server delivers via FCM and holds no APNs
    // sender, so registering an iOS token would store an undeliverable row.
    logInfo("push.skipped", { reason: "platform not configured" });
    return null;
  }
  const notifications = await loadNotifications();
  if (!notifications) {
    // Expo Go has no native FCM module: raw device tokens are unavailable.
    // The notifications screen surfaces this with a dev-build hint.
    logInfo("push.skipped", { reason: "Expo Go" });
    return null;
  }

  await ensureAndroidChannel();

  let { status } = await notifications.getPermissionsAsync();
  if (status !== "granted") {
    const requested = await notifications.requestPermissionsAsync();
    ({ status } = requested);
  }
  if (status !== "granted") {
    logInfo("push.skipped", { reason: "permission not granted" });
    return null;
  }

  try {
    // The native FCM registration token. Fails on a build without
    // google-services.json, and on emulators without Play services, which is
    // the signal to skip registration and surface the matching hint.
    const deviceToken = await notifications.getDevicePushTokenAsync();
    const token =
      typeof deviceToken.data === "string" ? deviceToken.data : null;
    if (!token) {
      logWarn("push.token_failed", { reason: "empty token" });
      return null;
    }
    if (token === lastRegisteredToken) {
      return token;
    }
    const registration = await runWithInstallToken(
      () => postToken(token, "android"),
      (result) => result === "install-token-required"
    );
    if (registration === "registered") {
      lastRegisteredToken = token;
      logInfo("push.registered");
      return token;
    }
    return null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Missing Firebase config and Play-services-less emulators fail here with
    // distinct native messages; keep the raw reason so the banner can name it.
    logWarn("push.token_failed", { reason });
    return null;
  }
}

// Clears the in-memory dedupe so the next register re-sends the token.
export function resetPushRegistration(): void {
  lastRegisteredToken = null;
}

// Unregisters the last-known token (best-effort, on sign-out).
export async function unregisterPushNotifications(): Promise<void> {
  if (lastRegisteredToken) {
    await unregisterToken(lastRegisteredToken);
    lastRegisteredToken = null;
  }
}

export interface PushReceivedListener {
  remove: () => void;
}

// Subscribes to foreground push notifications to trigger live UI refreshes
// (such as the notification bell badge) the moment an alert arrives.
export function subscribeToPushReceived(
  onReceived: (notification: Notifications.Notification) => void
): PushReceivedListener {
  let active = true;
  let removeSubscription: (() => void) | null = null;
  const notificationPromise = loadNotifications();
  if (!notificationPromise) {
    return {
      remove: () => {
        /* empty */
      },
    };
  }
  void (async () => {
    const notifications = await notificationPromise;
    if (!active || !notifications) {
      return;
    }
    const sub = notifications.addNotificationReceivedListener(onReceived);
    removeSubscription = () => sub.remove();
  })();
  return {
    remove: () => {
      active = false;
      removeSubscription?.();
    },
  };
}

export interface PushTapListener {
  remove: () => void;
}

// Routes a notification tap. Subscribes to future taps and also drains the
// tap that launched the app (cold start), which the runtime stores until read.
//
// `navigate` is injected so the caller (which holds the router) decides how a
// route is pushed; this module stays free of navigation imports.
export function subscribeToPushTaps(
  navigate: (route: string) => void,
  isReady: () => boolean
): PushTapListener {
  let active = true;
  let removeSubscription: (() => void) | null = null;
  const notificationPromise = loadNotifications();
  if (!notificationPromise) {
    return {
      remove: () => {
        /* empty */
      },
    };
  }

  // A tap arriving before the navigator mounts used to be dropped, so a cold
  // start from a notification landed on home instead of the target. Queue it
  // and flush on the next ready tap or poll, up to once per launch.
  let pendingPath: string | null = null;
  const flushPending = (): void => {
    if (pendingPath && isReady()) {
      const next = pendingPath;
      pendingPath = null;
      navigate(next);
    }
  };
  const handle = (response: Notifications.NotificationResponse | null) => {
    const path = response?.notification.request.content.data?.path;
    const route = typeof path === "string" ? pathToNativeRoute(path) : "/notifications";
    if (!response) {
      flushPending();
      return;
    }
    if (!isReady()) {
      pendingPath = route;
      // Retry shortly: the navigator usually mounts within a second of the
      // tap listener subscribing.
      setTimeout(flushPending, 1500);
      return;
    }
    navigate(route);
  };

  void (async () => {
    const notifications = await notificationPromise;
    if (!active) {
      return;
    }
    const subscription =
      notifications.addNotificationResponseReceivedListener(handle);
    removeSubscription = () => subscription.remove();
    let lastResponse: Notifications.NotificationResponse | null = null;
    try {
      lastResponse = await notifications.getLastNotificationResponseAsync();
    } catch {
      lastResponse = null;
    }
    handle(lastResponse);
  })();

  return {
    remove: () => {
      active = false;
      removeSubscription?.();
    },
  };
}

export function subscribeToPushTokenChanges(
  listener: () => void
): PushTapListener {
  let active = true;
  let removeSubscription: (() => void) | null = null;
  const notificationPromise = loadNotifications();
  if (!notificationPromise) {
    return {
      remove: () => {
        /* empty */
      },
    };
  }
  void (async () => {
    const notifications = await notificationPromise;
    if (!active) {
      return;
    }
    const subscription = notifications.addPushTokenListener(listener);
    removeSubscription = () => subscription.remove();
  })();
  return {
    remove: () => {
      active = false;
      removeSubscription?.();
    },
  };
}
