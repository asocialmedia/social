import { existsSync } from "node:fs";
import path from "node:path";

import appJson from "./app.json";

type AppConfig = Record<string, unknown> & {
  android?: Record<string, unknown>;
};

const { version } = appJson.expo;
const [major = 0, minor = 0, patch = 0] = version
  .split(".")
  .map((part) => Math.trunc(Number(part)) || 0);

// Android needs a monotonically increasing integer versionCode for upgrades,
// but `expo prebuild` otherwise stamps a constant 1. Derive it from the
// semantic version so successive APK releases are distinguishable; allow a CI
// override for out-of-band builds.
const derivedVersionCode = major * 10_000 + minor * 100 + patch;

// Relative to the Expo project root (apps/mobile); the Google Services plugin
// resolves it against that root.
const GOOGLE_SERVICES_FILE = "./google-services.json";

// `expo prebuild` hard-fails when android.googleServicesFile is declared but
// the file is absent (@expo/config-plugins throws rather than skipping). The
// file is gitignored and project-specific, so declaring it unconditionally
// would break every Firebase-less checkout - including a dev client built
// before Firebase exists. Only reference it when it is actually present; with
// no file the Google Services plugin is never applied and native push stays
// off, which the app already handles.
//
// process.cwd() is the Expo project root for every entry point here: the
// package scripts run from apps/mobile, and build-android-apk.ts sets that cwd
// before invoking prebuild (the file is provisioned there first).
const hasGoogleServices = existsSync(
  path.resolve(process.cwd(), GOOGLE_SERVICES_FILE)
);

const appConfig = ({ config }: { config: AppConfig }): AppConfig => ({
  ...config,
  android: {
    ...config.android,
    versionCode: Number(process.env.ANDROID_VERSION_CODE) || derivedVersionCode,
    ...(hasGoogleServices ? { googleServicesFile: GOOGLE_SERVICES_FILE } : {}),
  },
});

export default appConfig;
