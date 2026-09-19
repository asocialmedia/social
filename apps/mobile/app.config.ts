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

const appConfig = ({ config }: { config: AppConfig }): AppConfig => ({
  ...config,
  android: {
    ...config.android,
    versionCode: Number(process.env.ANDROID_VERSION_CODE) || derivedVersionCode,
  },
});

export default appConfig;
