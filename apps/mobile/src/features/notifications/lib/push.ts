// Native push registration: obtains an Expo push token and registers it with
// the API, then keeps it fresh and routes taps.
//
// Every step is best-effort and gated so the app works unchanged without push
// configuration:
// - Expo requires an EAS project id (EXPO_PUBLIC_EAS_PROJECT_ID) and, for
//   Android, Firebase credentials on the Expo project. Without the project id
//   the token call cannot run, so registration is skipped rather than throwing.
// - Permission is requested once, lazily, after sign-in; a denial just leaves
//   the device unregistered.
// - The endpoint is install-token gated server-side, so a fresh install that
//   fails that check simply retries on the next foreground.
//
// Tap routing: a notification carries `data.path` (a web path such as
// /posts/abcd1234). Post paths map onto the native detail screen; everything
// else resolves to the notifications list, which always exists.

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { logInfo, logWarn } from "@/lib/telemetry";

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

function resolveProjectId(): string | null {
  const explicit = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  if (explicit) {
    return explicit;
  }
  // A dev client / EAS build stamps the project id into the manifest; a bare
  // local build has none.
  const fromConfig =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  return typeof fromConfig === "string" && fromConfig.length > 0
    ? fromConfig
    : null;
}

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
      body: JSON.stringify({ platform, provider: "expo", token }),
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

/**
 * Requests permission and registers this device. Safe to call repeatedly:
 * a token already registered this session is not re-sent. Returns the token,
 * or null when push is unavailable (no project id, no permission, simulator).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    // Push tokens are not issued to simulators/emulators.
    return null;
  }
  const projectId = resolveProjectId();
  if (!projectId) {
    logInfo("push.skipped", { reason: "no project id" });
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
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    if (!token) {
      return null;
    }
    if (token === lastRegisteredToken) {
      return token;
    }
    const ok = await postToken(
      token,
      Platform.OS === "ios" ? "ios" : "android"
    );
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

/** Clears the in-memory dedupe so the next register re-sends the token. */
export function resetPushRegistration(): void {
  lastRegisteredToken = null;
}

/** Unregisters the last-known token (best-effort, on sign-out). */
export async function unregisterPushNotifications(): Promise<void> {
  if (lastRegisteredToken) {
    await unregisterToken(lastRegisteredToken);
    lastRegisteredToken = null;
  }
}

// Maps a push payload's web path onto a native route. Post paths carry the
// short id (or full id) after /posts/, either at the root (/posts/<id>) or
// nested in a community (/a/<slug>/posts/<id>); the detail screen accepts
// either id form and has no community-aware route yet, so the community
// segment is dropped and the post itself opens.
export function pathToNativeRoute(path: string): string {
  const postMatch =
    /^\/posts\/(?<id>[^/?#]+)/.exec(path) ??
    /^\/a\/[^/]+\/posts\/(?<id>[^/?#]+)/.exec(path);
  const id = postMatch?.groups?.id;
  return id ? `/posts/${id}` : "/notifications";
}

export interface PushTapListener {
  remove: () => void;
}

/**
 * Routes a notification tap. Subscribes to future taps and also drains the
 * tap that launched the app (cold start), which the runtime stores until read.
 *
 * `navigate` is injected so the caller (which holds the router) decides how a
 * route is pushed; this module stays free of navigation imports.
 */
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
