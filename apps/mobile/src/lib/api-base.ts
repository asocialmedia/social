// Pure API base-URL resolution (no React Native imports, unit tested).
// The app always talks to the web origin: in production the APK must hit
// prod, in dev it hits the local dev servers. No secrets live here.

export const PROD_API_URL = "https://asocialmedia.cc";
export const DEV_ANDROID_EMULATOR_API_URL = "http://10.0.2.2:3000";
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
    ? DEV_ANDROID_EMULATOR_API_URL
    : DEV_DEFAULT_API_URL;
}

// better-auth handler root behind the web proxy (the proxy injects origin
// + x-internal-secret server-side, so the app never carries secrets).
export function authBaseUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl}/api/auth`;
}
