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

import { isRunningInExpoGo } from "expo";
import type * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { withAuthHeaders } from "@/lib/auth-headers";
import { logInfo, logWarn } from "@/lib/telemetry";

import { pathToNativeRoute } from "./push-path";
import {
  publishPushSetupStatus,
  pushFailureStatus,
  pushSetupPrecheck,
} from "./push-setup";
import { createPushTokenObserver } from "./push-token-observer";

export { pathToNativeRoute } from "./push-path";

const ANDROID_CHANNEL_ID = "default";

// Foreground presentation: show the banner and play sound even while the app
// is open, so live notifications alert visibly and audibly.
type NotificationsModule = typeof Notifications;
let notificationsPromise: Promise<NotificationsModule> | null = null;

function loadNotifications(): Promise<NotificationsModule> | null {
  if (Platform.OS === "web" || isRunningInExpoGo()) {
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
let registrationGeneration = 0;
let registrationFlight: {
  generation: number;
  promise: Promise<string | null>;
} | null = null;

export function registerForPushNotifications(
  runWithInstallToken: RunWithInstallToken
): Promise<string | null> {
  const generation = registrationGeneration;
  if (registrationFlight?.generation === generation) {
    return registrationFlight.promise;
  }
  const previous = registrationFlight?.promise;
  const publish = (status: Parameters<typeof publishPushSetupStatus>[0]) => {
    if (registrationGeneration === generation) {
      publishPushSetupStatus(status);
    }
  };
  const promise = (async () => {
    // Serialize account changes so an older registration cannot overwrite the new owner.
    await previous;
    if (generation !== registrationGeneration) {
      return null;
    }
    try {
      const precheck = pushSetupPrecheck({
        isExpoGo: isRunningInExpoGo(),
        platform: Platform.OS,
      });
      if (precheck) {
        publish({ detail: precheck, reason: precheck });
        return null;
      }
      const notifications = await loadNotifications();
      if (!notifications) {
        return null;
      }
      await ensureAndroidChannel();
      let permission = await notifications.getPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) {
        permission = await notifications.requestPermissionsAsync();
      }
      if (!permission.granted) {
        publish({
          detail: "Notification permission was not granted.",
          reason: "permission-denied",
        });
        return null;
      }
      const deviceToken = await notifications.getDevicePushTokenAsync();
      const token =
        typeof deviceToken.data === "string" ? deviceToken.data : null;
      if (generation !== registrationGeneration) {
        return null;
      }
      if (!token) {
        throw new Error("FCM returned an empty token");
      }
      if (token === lastRegisteredToken) {
        publish({ detail: "Registered", reason: "ready" });
        return token;
      }
      const registration = await runWithInstallToken(
        () =>
          generation === registrationGeneration
            ? postToken(token, "android")
            : Promise.resolve("failed"),
        (result) => result === "install-token-required"
      );
      if (generation !== registrationGeneration) {
        return null;
      }
      if (registration !== "registered") {
        publish({
          detail:
            "Couldn't register notifications with the server. Check your connection and try again.",
          reason: "unknown",
        });
        return null;
      }
      lastRegisteredToken = token;
      publish({ detail: "Registered", reason: "ready" });
      logInfo("push.registered");
      return token;
    } catch (error) {
      publish(pushFailureStatus(error));
      logWarn("push.registration_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })();
  registrationFlight = { generation, promise };
  void (async () => {
    await promise;
    if (registrationFlight?.promise === promise) {
      registrationFlight = null;
    }
  })();
  return promise;
}

// Clears the in-memory dedupe so the next register re-sends the token.
export function resetPushRegistration(): void {
  registrationGeneration += 1;
  lastRegisteredToken = null;
  publishPushSetupStatus(null);
}

// Unregisters the last-known token (best-effort, on sign-out).
export async function unregisterPushNotifications(): Promise<void> {
  registrationGeneration += 1;
  publishPushSetupStatus(null);
  if (lastRegisteredToken) {
    await unregisterToken(lastRegisteredToken);
    lastRegisteredToken = null;
  }
}

function runPushListener(action: () => Promise<void>): void {
  void (async () => {
    try {
      await action();
    } catch (error) {
      logWarn("push.listener_failed", { reason: String(error) });
    }
  })();
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
        // Notifications are unavailable in this runtime.
      },
    };
  }
  runPushListener(async () => {
    const notifications = await notificationPromise;
    if (!active || !notifications) {
      return;
    }
    const sub = notifications.addNotificationReceivedListener(onReceived);
    removeSubscription = () => sub.remove();
  });
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
        // Notifications are unavailable in this runtime.
      },
    };
  }

  // A tap arriving before the navigator mounts used to be dropped, so a cold
  // start from a notification landed on home instead of the target. Queue it
  // and flush on the next ready tap or poll, up to once per launch.
  let pendingPath: string | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  const handled = new Set<string>();
  const flushPending = (): void => {
    if (!active) {
      return;
    }
    if (pendingPath && isReady()) {
      const next = pendingPath;
      pendingPath = null;
      navigate(next);
    } else if (pendingPath) {
      pendingTimer = setTimeout(flushPending, 100);
    }
  };
  const handle = (response: Notifications.NotificationResponse | null) => {
    const path = response?.notification.request.content.data?.path;
    const route =
      typeof path === "string" ? pathToNativeRoute(path) : "/notifications";
    if (!response) {
      flushPending();
      return;
    }
    const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
    if (!active || handled.has(key)) {
      return;
    }
    handled.add(key);
    runPushListener(async () => {
      const notifications = await notificationPromise;
      await notifications.clearLastNotificationResponseAsync();
    });
    if (!isReady()) {
      pendingPath = route;
      // Retry shortly: the navigator usually mounts within a second of the
      // tap listener subscribing.
      if (pendingTimer) {
        clearTimeout(pendingTimer);
      }
      pendingTimer = setTimeout(flushPending, 100);
      return;
    }
    navigate(route);
  };

  runPushListener(async () => {
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
  });

  return {
    remove: () => {
      active = false;
      if (pendingTimer) {
        clearTimeout(pendingTimer);
      }
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
        // Notifications are unavailable in this runtime.
      },
    };
  }
  runPushListener(async () => {
    const notifications = await notificationPromise;
    if (!active) {
      return;
    }
    const onToken = createPushTokenObserver(
      () => lastRegisteredToken,
      listener
    );
    const subscription = notifications.addPushTokenListener((token) =>
      onToken(token.data)
    );
    removeSubscription = () => subscription.remove();
  });
  return {
    remove: () => {
      active = false;
      removeSubscription?.();
    },
  };
}
