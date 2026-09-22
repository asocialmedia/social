// Pure API base-URL resolution (no React Native imports, unit tested).
// The app always talks to the web origin: in production the APK must hit
// prod, in dev it hits the local dev servers. No secrets live here.

export const PROD_API_URL = "https://asocialmedia.cc";

// Dev on Android resolves to the SAME host string the other dev pieces use.
// `bun run dev:android` runs `adb reverse` for 3000/3001/8082, so on the
// emulator (or a USB device) `localhost` reaches this machine. That matters
// because three things must share one host for browser OAuth to complete:
// the API host (where the expo-authorization-proxy sets its state cookie),
// the provider redirect host (the auth service at localhost:3001), and the
// Turnstile page origin (localhost). The historical emulator alias
// 10.0.2.2 reaches the host without adb but breaks that alignment, so it is
// kept only as an opt-in fallback via EXPO_PUBLIC_DEV_API_URL.
export const DEV_ANDROID_API_URL = "http://localhost:3000";
export const DEV_ANDROID_EMULATOR_ALIAS_URL = "http://10.0.2.2:3000";
export const DEV_DEFAULT_API_URL = "http://localhost:3000";

export type ApiPlatform = "android" | "ios" | "web" | string;

export interface ApiBaseOptions {
  dev: boolean;
  devApiUrl?: string;
  platform: ApiPlatform;
  publicApiUrl?: string;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

// Release builds must never talk to a cleartext or non-http(s) origin: the
// session cookie rides every request, so an `http://` override would leak it
// on the wire. An unusable override falls back to prod rather than shipping.
function resolveReleaseBaseUrl(publicApiUrl: string | undefined): string {
  const candidate = normalizeBaseUrl(publicApiUrl ?? "");
  if (!candidate) {
    return PROD_API_URL;
  }
  if (!candidate.startsWith("https://")) {
    return PROD_API_URL;
  }
  return candidate;
}

export function resolveApiBaseUrl(options: ApiBaseOptions): string {
  if (!options.dev) {
    return resolveReleaseBaseUrl(options.publicApiUrl);
  }
  if (options.devApiUrl?.trim()) {
    return normalizeBaseUrl(options.devApiUrl);
  }
  return options.platform === "android"
    ? DEV_ANDROID_API_URL
    : DEV_DEFAULT_API_URL;
}

// better-auth handler root behind the web proxy (the proxy injects origin
// + x-internal-secret server-side, so the app never carries secrets).
export function authBaseUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl}/api/auth`;
}

// Passkeys are WebAuthn: the relying party must be served over https, and on
// Android the rpID must be a real domain with assetlinks. A dev API on
// http://localhost can therefore never complete a passkey ceremony.
export function supportsPasskeyOrigin(apiBaseUrl: string): boolean {
  return apiBaseUrl.startsWith("https://");
}
