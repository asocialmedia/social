// Push setup diagnostics: why push is or is not working on this device.
// Raw FCM tokens need a dev build (or release APK) with google-services.json
// on Android with Google Play services. Expo Go, emulators without Play,
// and denied permissions all fail at distinct steps, and the old code logged
// only "skipped" with no surface for the user. This module names the step so
// the notifications screen can show the fix instead of silence.
// Pure checks are exported for tests; native checks use dynamic imports so bun
// never parses react-native.
export type PushSetupReason =
  | "ready"
  | "expo-go"
  | "web"
  | "ios-unsupported"
  | "emulator"
  | "no-firebase"
  | "permission-denied"
  | "unknown";

export interface PushSetupStatus {
  detail: string;
  reason: PushSetupReason;
}

// Human copy for the notifications screen banner.
export function pushSetupCopy(status: PushSetupStatus): {
  action: string;
  body: string;
  title: string;
} {
  switch (status.reason) {
    case "ready": {
      return { action: "", body: "", title: "" };
    }
    case "expo-go": {
      return {
        action: "Use a dev build",
        body: "Expo Go cannot receive raw FCM tokens. Install a development or release build to enable push.",
        title: "Push needs a dev build",
      };
    }
    case "emulator": {
      return {
        action: "",
        body: "Emulators rarely hold a valid FCM registration. Test push on a physical Android device with Play services.",
        title: "Push needs a physical device",
      };
    }
    case "no-firebase": {
      return {
        action: "",
        body: "This build has no Firebase config (google-services.json). Rebuild the application with Firebase to enable push.",
        title: "Push not configured in this build",
      };
    }
    case "permission-denied": {
      return {
        action: "Open settings",
        body: "Notifications are turned off for this app. Enable them in system settings to receive alerts.",
        title: "Notifications are off",
      };
    }
    case "ios-unsupported": {
      return {
        action: "",
        body: "Push currently ships on Android only (FCM). iOS registration is skipped so no undeliverable token is stored.",
        title: "Push is Android-only for now",
      };
    }
    default: {
      return {
        action: "Try again",
        body:
          status.detail ||
          "Push registration failed. Foreground the app and try again.",
        title: "Push unavailable",
      };
    }
  }
}

// Synchronous pre-checks that need no native modules.
export function pushSetupPrecheck(opts: {
  executionEnvironment?: string | null;
  isExpoGo?: boolean;
  platform: string;
}): PushSetupReason | null {
  if (opts.platform === "web") {
    return "web";
  }
  if (opts.platform !== "android") {
    return "ios-unsupported";
  }
  if (opts.isExpoGo ?? opts.executionEnvironment === "storeClient") {
    return "expo-go";
  }
  return null;
}

// Registration publishes its actual result; the screen observes recovery as well as failure.
let registrationStatus: PushSetupStatus | null = null;
const listeners = new Set<() => void>();

export function publishPushSetupStatus(status: PushSetupStatus | null): void {
  registrationStatus = status;
  for (const listener of listeners) {
    listener();
  }
}

export function readPushSetupStatus(): PushSetupStatus | null {
  return registrationStatus;
}

export function subscribePushSetupStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function pushFailureStatus(error: unknown): PushSetupStatus {
  const detail = error instanceof Error ? error.message : String(error);
  const missingFirebase =
    /default FirebaseApp|FirebaseApp.*initializ|google-services|missing.*firebase/i.test(
      detail
    );
  return {
    detail: missingFirebase
      ? "Firebase configuration is missing from this build."
      : "Couldn't register notifications. Check your connection and try again.",
    reason: missingFirebase ? "no-firebase" : "unknown",
  };
}

// Expo Go has its own native module. Embedded release manifests also expose
// expoGoConfig, so that property cannot identify the app runtime.
export async function getPushSetupStatus(): Promise<PushSetupStatus> {
  try {
    const { isRunningInExpoGo } = await import("expo");
    const { Platform } = await import("react-native");
    const precheck = pushSetupPrecheck({
      isExpoGo: isRunningInExpoGo(),
      platform: Platform.OS,
    });
    if (precheck) {
      return { detail: precheck, reason: precheck };
    }
    const notifications = await import("expo-notifications");
    const permission = await notifications.getPermissionsAsync();
    if (!permission.granted && !permission.canAskAgain) {
      return {
        detail: "Notifications are disabled in system settings.",
        reason: "permission-denied",
      };
    }
    return (
      registrationStatus ?? {
        detail: "Registration will run after sign-in.",
        reason: "ready",
      }
    );
  } catch (error) {
    return pushFailureStatus(error);
  }
}
