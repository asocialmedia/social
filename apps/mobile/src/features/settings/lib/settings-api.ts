// Settings API client. Every route here already existed on the server; the
// native app simply had no caller, so the account and security tabs had nothing
// to drive them.
//
// The two shapes that matter:
//   - Mutations answer with a result union so "the server wants an install
//     token" is distinguishable from a real failure, which is what lets
//     runWithInstallToken retry. Same convention as the community and follow
//     mutations.
//   - Reads return null rather than throwing when the viewer is signed out, so
//     a guest opening settings sees empty state instead of an error.
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";

export type SettingsMutationResult =
  | { kind: "error"; message: string; status: number }
  | { kind: "install-token-required" }
  | { kind: "success"; data?: unknown };

export function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function boolOf(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function stringArrayOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessageOf(body: unknown, fallback: string): string {
  const structured = textOf(objectOf(body)?.error);
  if (structured) {
    return structured;
  }
  // Some of these routes answer with a bare string body.
  return typeof body === "string" && body ? body : fallback;
}

/** One writer for every settings mutation, so the token branch lives once. */
export async function mutateSettings(
  path: string,
  method: "DELETE" | "PATCH" | "POST",
  body: unknown,
  options: ApiCallOptions,
  fallbackMessage: string
): Promise<SettingsMutationResult> {
  const headers: Record<string, string> = {
    ...(options.cookie ? { cookie: options.cookie } : null),
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  try {
    const response = await (options.baseFetch ?? fetch)(
      `${options.apiBase}${path}`,
      {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers,
        method,
      }
    );
    const parsed = await readBody(response);
    if (response.ok) {
      return { data: parsed, kind: "success" };
    }
    if (
      response.status === 403 &&
      textOf(objectOf(parsed)?.error) === "install-token-required"
    ) {
      return { kind: "install-token-required" };
    }
    return {
      kind: "error",
      message: errorMessageOf(parsed, fallbackMessage),
      status: response.status,
    };
  } catch {
    return { kind: "error", message: fallbackMessage, status: 0 };
  }
}

export async function readSettings<T>(
  path: string,
  options: ApiCallOptions,
  parse: (payload: unknown) => T
): Promise<T | null> {
  try {
    const response = await (options.baseFetch ?? fetch)(
      `${options.apiBase}${path}`,
      { headers: options.cookie ? { cookie: options.cookie } : {} }
    );
    if (!response.ok) {
      return null;
    }
    return parse(await readBody(response));
  } catch {
    return null;
  }
}

// --- Account -----------------------------------------------------------------

export interface UsernameChangeResult {
  aliasExpiresAt: string | null;
  changed: boolean;
}

export interface UsernameChangePayload {
  aliasExpiresAt: string | null;
  changed: boolean;
}

export function parseUsernameChange(payload: unknown): UsernameChangeResult {
  const body = objectOf(payload) ?? {};
  return {
    aliasExpiresAt: textOf(body.aliasExpiresAt),
    changed: boolOf(body.changed),
  };
}

export function changeUsername(
  username: string,
  options: ApiCallOptions
): Promise<SettingsMutationResult> {
  return mutateSettings(
    "/api/users/username",
    "PATCH",
    { username },
    options,
    "Couldn't change your username"
  );
}

export function sendCurrentEmailCode(
  options: ApiCallOptions
): Promise<SettingsMutationResult> {
  return mutateSettings(
    "/api/users/email/send-code",
    "POST",
    {},
    options,
    "Couldn't send the code"
  );
}

export function requestEmailChange(
  email: string,
  otp: string,
  options: ApiCallOptions
): Promise<SettingsMutationResult> {
  return mutateSettings(
    "/api/users/email",
    "PATCH",
    { email, otp },
    options,
    "Couldn't update your email"
  );
}

export function verifyEmailChange(
  email: string,
  otp: string,
  options: ApiCallOptions
): Promise<SettingsMutationResult> {
  return mutateSettings(
    "/api/users/email/verify",
    "POST",
    { email, otp },
    options,
    "Couldn't verify that code"
  );
}

export function setPassword(
  password: string,
  options: ApiCallOptions
): Promise<SettingsMutationResult> {
  return mutateSettings(
    "/api/users/password",
    "POST",
    { password },
    options,
    "Couldn't set your password"
  );
}

/** Web reloads after an unlink so every server-rendered surface resettles. */
export function unlinkProvider(
  provider: string,
  options: ApiCallOptions
): Promise<SettingsMutationResult> {
  return mutateSettings(
    `/api/auth/unlink/${encodeURIComponent(provider)}`,
    "POST",
    {},
    options,
    "Couldn't disconnect that account"
  );
}

// --- Security ----------------------------------------------------------------

export interface SecuritySession {
  country: string | null;
  createdAt: string;
  current: boolean;
  expiresAt: string | null;
  id: string;
  ipAddress: string | null;
  updatedAt: string;
  userAgent: string | null;
}

// The route answers with a bare array today; a wrapped { sessions } shape is
// accepted too so a future envelope change cannot silently blank the list.
function sessionRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const wrapped = objectOf(payload);
  return wrapped && Array.isArray(wrapped.sessions) ? wrapped.sessions : [];
}

export function parseSecuritySessions(payload: unknown): SecuritySession[] {
  return sessionRows(payload).flatMap((row) => {
    const body = objectOf(row);
    if (!body || typeof body.id !== "string") {
      return [];
    }
    return [
      {
        country: textOf(body.country),
        createdAt: textOf(body.createdAt) ?? "",
        current: boolOf(body.current),
        expiresAt: textOf(body.expiresAt),
        id: body.id,
        ipAddress: textOf(body.ipAddress),
        updatedAt: textOf(body.updatedAt) ?? "",
        userAgent: textOf(body.userAgent),
      },
    ];
  });
}

export function fetchSecuritySessions(
  options: ApiCallOptions
): Promise<SecuritySession[] | null> {
  return readSettings("/api/security/sessions", options, parseSecuritySessions);
}

export function revokeSecuritySession(
  sessionId: string,
  action: "all" | "other-sessions" | "single",
  options: ApiCallOptions
): Promise<SettingsMutationResult> {
  return mutateSettings(
    "/api/security/sessions",
    "DELETE",
    { action, sessionId },
    options,
    "Couldn't sign that device out"
  );
}

export function reauthenticate(
  password: string,
  options: ApiCallOptions
): Promise<SettingsMutationResult> {
  return mutateSettings(
    "/api/security/reauthenticate",
    "POST",
    { password },
    options,
    "Couldn't confirm it's you"
  );
}

export interface PasskeyEntry {
  backedUp: boolean;
  createdAt: string | null;
  id: string;
  name: string | null;
}

export function parsePasskeys(payload: unknown): PasskeyEntry[] {
  const body = objectOf(payload);
  const rows = Array.isArray(payload)
    ? payload
    : (body?.passkeys as unknown[] | undefined);
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const entry = objectOf(row);
    if (!entry || typeof entry.id !== "string") {
      return [];
    }
    return [
      {
        backedUp: boolOf(entry.backedUp),
        createdAt: textOf(entry.createdAt),
        id: entry.id,
        name: textOf(entry.name),
      },
    ];
  });
}
