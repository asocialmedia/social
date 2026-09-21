// Platform half of the install credential: SecureStore persistence and the
// registration call. The pure helpers live in ./install-token.ts.

import * as SecureStore from "expo-secure-store";

import { getApiBaseUrl } from "./api-env";
import { parseRegisterResponse } from "./install-token";
import type { InstallCredentials } from "./install-token";
import { logError, logInfo, logWarn } from "./telemetry";

/** SecureStore key holding the token. */
const INSTALL_TOKEN_STORAGE_KEY = "asm.install-token";

/** SecureStore key holding the server-issued install id (for logs/support). */
const INSTALL_ID_STORAGE_KEY = "asm.install-id";

// In-memory copy so the hot path (a header on every request) never awaits
// SecureStore. `undefined` means "not loaded yet"; `null` means "loaded, none".
let cachedToken: string | null | undefined;

/** Reads the persisted token into memory. Safe to call repeatedly. */
export async function loadInstallToken(): Promise<string | null> {
  if (cachedToken !== undefined) {
    return cachedToken;
  }
  try {
    cachedToken = await SecureStore.getItemAsync(INSTALL_TOKEN_STORAGE_KEY);
  } catch (error) {
    logError("install.token_load_failed", error);
    cachedToken = null;
  }
  return cachedToken;
}

/** Returns the cached token synchronously, for header attachment. */
export function peekInstallToken(): string | null {
  return cachedToken ?? null;
}

async function persist(credentials: InstallCredentials): Promise<void> {
  cachedToken = credentials.token;
  await SecureStore.setItemAsync(INSTALL_TOKEN_STORAGE_KEY, credentials.token);
  await SecureStore.setItemAsync(INSTALL_ID_STORAGE_KEY, credentials.installId);
}

/**
 * Exchanges a solved Turnstile challenge for an install token and persists it.
 * Returns the credentials, or null when the server refused or was unreachable.
 */
export async function registerInstall(
  turnstileToken: string,
  timeoutMs = 20_000
): Promise<InstallCredentials | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/mobile/register`, {
      body: JSON.stringify({ turnstileToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = (payload as { error?: string } | null)?.error ?? "unknown";
      logWarn("install.register_rejected", {
        reason,
        status: response.status,
      });
      return null;
    }
    const credentials = parseRegisterResponse(payload);
    if (!credentials) {
      logWarn("install.register_bad_payload", { status: response.status });
      return null;
    }
    await persist(credentials);
    logInfo("install.registered");
    return credentials;
  } catch (error) {
    logError("install.register_failed", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Clears the stored token (used when the server rejects it as invalid). */
export async function clearInstallToken(): Promise<void> {
  cachedToken = null;
  try {
    await SecureStore.deleteItemAsync(INSTALL_TOKEN_STORAGE_KEY);
    await SecureStore.deleteItemAsync(INSTALL_ID_STORAGE_KEY);
  } catch (error) {
    logError("install.token_clear_failed", error);
  }
}
