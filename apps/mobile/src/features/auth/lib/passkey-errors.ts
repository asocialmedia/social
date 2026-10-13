import { PASSKEY_FAILED_ERROR } from "./auth-errors";

export const PASSKEY_NOT_REGISTERED_ERROR =
  "Add a passkey in Settings → Security first.";

export function describePasskeyFailure(
  error: unknown
): { cancelled: true } | { error: string } {
  const record = error && typeof error === "object" ? error : null;
  const code =
    record && "code" in record && typeof record.code === "string"
      ? record.code
      : "";
  const message =
    record && "message" in record && typeof record.message === "string"
      ? record.message
      : "";
  if (
    /no (?:available )?(?:credentials?|passkeys?)|no credentials available/i.test(
      message
    )
  ) {
    return { error: PASSKEY_NOT_REGISTERED_ERROR };
  }
  if (
    code === "CANCELLED" ||
    ((code === "AUTH_CANCELLED" || !code) &&
      /\b(?:(?:user|auth|authentication) )?cancel(?:led|ed)\b/i.test(message))
  ) {
    return { cancelled: true };
  }
  return { error: PASSKEY_FAILED_ERROR };
}
