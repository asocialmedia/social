// Security API client for the native settings security tab. Mirrors web's
// `security-settings.tsx` data flow: passkeys through better-auth's passkey
// plugin, two-factor through the two-factor plugin, and message identity
// through the messages client. Reuses the settings mutate/read helpers so the
// install-token branch lives once.
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";

import {
  boolOf,
  mutateSettings,
  objectOf,
  readSettings,
  stringArrayOf,
  textOf,
} from "./settings-api";
import type { SettingsMutationResult } from "./settings-api";

export interface SecurityState {
  hasAuthenticatorApp: boolean;
  hasPassword: boolean;
  linkedProviders: string[];
}

// The server-side facts the session payload omits: whether a TOTP credential
// is verified, whether a password exists, and which social providers are
// linked. Web reads these in `settings/page.tsx`; native reads this route.
export function parseSecurityState(payload: unknown): SecurityState {
  const body = objectOf(payload) ?? {};
  return {
    hasAuthenticatorApp: boolOf(body.hasAuthenticatorApp),
    hasPassword: boolOf(body.hasPassword),
    linkedProviders: stringArrayOf(body.linkedProviders),
  };
}

export function fetchSecurityState(
  options: ApiCallOptions
): Promise<SecurityState | null> {
  return readSettings("/api/security/state", options, parseSecurityState);
}

export interface PasskeyEntry {
  aaguid: string | null;
  backedUp: boolean;
  createdAt: string;
  deviceType: string;
  id: string;
  name: string | null;
}

function isPasskey(value: unknown): value is Record<string, unknown> {
  const record = objectOf(value);
  return Boolean(record && typeof record.id === "string");
}

export function parsePasskeys(payload: unknown): PasskeyEntry[] {
  const rows = Array.isArray(payload)
    ? payload
    : (objectOf(payload)?.passkeys as unknown[] | undefined);
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (!isPasskey(row)) {
      return [];
    }
    return [
      {
        aaguid: textOf(row.aaguid),
        backedUp: boolOf(row.backedUp),
        createdAt: textOf(row.createdAt) ?? "",
        deviceType: textOf(row.deviceType) ?? "singleDevice",
        id: String(row.id),
        name: textOf(row.name),
      },
    ];
  });
}

// The passkey list route answers with a bare array; accept a wrapped
// `{ passkeys }` shape too so a future envelope change cannot blank the list.
export function fetchPasskeys(
  options: ApiCallOptions
): Promise<PasskeyEntry[] | null> {
  return readSettings(
    "/api/auth/passkey/list-user-passkeys",
    options,
    parsePasskeys
  );
}

export interface PasskeyRemovalResult {
  error?: string;
  requiresReauthentication: boolean;
}

function isFreshSession(error: { message?: string; status?: number }): boolean {
  return (
    error.status === 403 &&
    error.message?.toLowerCase().includes("fresh") === true
  );
}

export async function removePasskey(
  id: string,
  options: ApiCallOptions
): Promise<PasskeyRemovalResult> {
  try {
    const response = await (options.baseFetch ?? fetch)(
      `${options.apiBase}/api/auth/passkey/delete-passkey`,
      {
        body: JSON.stringify({ id }),
        headers: {
          "content-type": "application/json",
          cookie: options.cookie ?? "",
        },
        method: "POST",
      }
    );
    if (response.ok) {
      return { requiresReauthentication: false };
    }
    const body: unknown = await response.json().catch(() => null);
    const message =
      textOf(objectOf(body)?.message) ?? textOf(objectOf(body)?.error);
    return {
      error: "Couldn't remove this passkey. Re-authenticate and try again.",
      requiresReauthentication: isFreshSession({
        message: message ?? undefined,
        status: response.status,
      }),
    };
  } catch {
    return {
      error: "Couldn't remove this passkey. Please try again.",
      requiresReauthentication: false,
    };
  }
}

export interface MessageIdentityResult {
  identityExists: boolean;
}

export function parseIdentity(payload: unknown): MessageIdentityResult {
  return {
    identityExists:
      objectOf(payload)?.identity !== null &&
      objectOf(payload)?.identity !== undefined,
  };
}

export function fetchMessageIdentity(
  options: ApiCallOptions
): Promise<MessageIdentityResult | null> {
  return readSettings("/api/messages/identity", options, parseIdentity);
}

export function resetMessageIdentity(
  options: ApiCallOptions
): Promise<SettingsMutationResult> {
  return mutateSettings(
    "/api/messages/identity",
    "DELETE",
    undefined,
    options,
    "Couldn't reset your messages key"
  );
}
