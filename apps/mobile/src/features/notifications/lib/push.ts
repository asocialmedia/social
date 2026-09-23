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

import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { logInfo, logWarn } from "@/lib/telemetry";

import { pathToNativeRoute } from "./push-path";

export { pathToNativeRoute } from "./push-path";

const ANDROID_CHANNEL_ID = "default";

// Foreground presentation: show the banner even while the app is open, so a
// live notification is not silently swallowed. Sound is off in-foreground (the
// OS plays it; a second cue would double up).
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
});

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    importance: Notifications.AndroidImportance.DEFAULT,
    name: "Notifications",
  });
}

// The push routes authenticate with the session cookie like every other API
// route (getSessionFromApi reads only the cookie); without it every register
// and unregister was a 401.
async function sessionHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const cookie = await authClient.getCookie();
  if (cookie) {
    headers.cookie = cookie;
  }
  return headers;
}

async function postToken(
  token: string,
  platform: "android" | "ios"
): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/push/device`, {
      body: JSON.stringify({ platform, provider: "fcm", token }),
      headers: await sessionHeaders(),
      method: "POST",
    });
    return response.ok;
  } catch (error) {
    logWarn("push.device_register_failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
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
// config in the build).
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    // Push tokens are not issued to simulators/emulators.
    return null;
  }
  if (Platform.OS !== "android") {
    // Only Android is wired: the server delivers via FCM and holds no APNs
    // sender, so registering an iOS token would store an undeliverable row.
    logInfo("push.skipped", { reason: "platform not configured" });
    return null;
  }

  await ensureAndroidChannel();

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    ({ status } = requested);
  }
  if (status !== "granted") {
    logInfo("push.skipped", { reason: "permission not granted" });
    return null;
  }

  try {
    // The native FCM registration token. Fails on a build without
    // google-services.json, which is the signal to skip registration.
    const deviceToken = await Notifications.getDevicePushTokenAsync();
    const token =
      typeof deviceToken.data === "string" ? deviceToken.data : null;
    if (!token) {
      return null;
    }
    if (token === lastRegisteredToken) {
      return token;
    }
    const ok = await postToken(token, "android");
    if (ok) {
      lastRegisteredToken = token;
      logInfo("push.registered");
      return token;
    }
    return null;
  } catch (error) {
    logWarn("push.token_failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
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
  const handle = (response: Notifications.NotificationResponse | null) => {
    const path = response?.notification.request.content.data?.path;
    if (!isReady()) {
      // Cold-start taps arrive before the router is mounted; dropping them is
      // acceptable (the app opens on Home), and racing the router is not.
      return;
    }
    if (typeof path === "string") {
      navigate(pathToNativeRoute(path));
    } else {
      navigate("/notifications");
    }
  };

  const subscription =
    Notifications.addNotificationResponseReceivedListener(handle);

  // The tap that cold-started the app, if any. Read once, then the listener
  // above covers every later tap (useLastNotificationResponse would re-fire).
  void (async () => {
    handle(await Notifications.getLastNotificationResponseAsync());
  })();

  return {
    remove: () => subscription.remove(),
  };
}
