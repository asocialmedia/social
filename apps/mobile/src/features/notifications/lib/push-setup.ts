// Push setup diagnostics: why push is or is not working on this device.
// Raw FCM tokens need a dev build (or release APK) with google-services.json
// on a physical Android device. Expo Go, simulators/emulators without Play,
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
        body: "Expo Go cannot receive raw FCM tokens. Run a dev build on a physical Android device to enable push.",
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
        body: "This build has no Firebase config (google-services.json). Rebuild the dev client with Firebase to enable push.",
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
  platform: string;
}): PushSetupReason | null {
  if (opts.platform === "web") {
    return "web";
  }
  if (opts.platform !== "android") {
    return "ios-unsupported";
  }
  if (opts.executionEnvironment === "storeClient") {
    return "expo-go";
  }
  return null;
}

// True on an emulator/simulator (no FCM registration possible in practice).
export async function isPhysicalDevice(): Promise<boolean> {
  try {
    const mod = await import("expo-device");
    const device = mod as unknown as { isDevice?: boolean };
    if (typeof device.isDevice === "boolean") {
      return device.isDevice;
    }
    return true;
  } catch {
    return true;
  }
}

// Full diagnostics for the current device. Best-effort, never throws.
export async function getPushSetupStatus(): Promise<PushSetupStatus> {
  try {
    const constantsMod = await import("expo-constants");
    const constants = constantsMod as unknown as {
      default?: {
        expoGoConfig?: unknown;
        executionEnvironment?: string | null;
      };
      expoGoConfig?: unknown;
      executionEnvironment?: string | null;
    };
    const executionEnvironment =
      constants.default?.executionEnvironment ??
      constants.executionEnvironment ??
      null;
    const expoGoConfig =
      constants.default?.expoGoConfig ?? constants.expoGoConfig ?? null;
    const { Platform } = await import("react-native");
    const platform = (Platform as unknown as { OS?: string }).OS ?? "unknown";
    const precheck = pushSetupPrecheck({
      executionEnvironment: expoGoConfig ? "storeClient" : executionEnvironment,
      platform,
    });
    if (precheck) {
      return { detail: precheck, reason: precheck };
    }
    if (!(await isPhysicalDevice())) {
      return { detail: "emulator", reason: "emulator" };
    }
    return { detail: "ok", reason: "ready" };
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : String(error),
      reason: "unknown",
    };
  }
}
