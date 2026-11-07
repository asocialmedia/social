// Method model for the inline 2FA challenge on the login screen. Pure: the
// screen renders the chips and inputs, this file owns which methods exist,
// what each one says, and when its code is submittable. Copy mirrors web's
// two-factor-form methodCopy.
export type TwoFactorMethod = "backup" | "email" | "totp";

export const TWO_FACTOR_METHODS: readonly TwoFactorMethod[] = [
  "email",
  "totp",
  "backup",
];

export const twoFactorMethodLabel: Record<TwoFactorMethod, string> = {
  backup: "Recovery",
  email: "Email code",
  totp: "Authenticator",
};

export const twoFactorMethodCopy: Record<TwoFactorMethod, string> = {
  backup: "Enter one of your unused recovery codes.",
  email: "We’ll send a one-time security code to your verified email address.",
  totp: "Enter the six-digit code from your authenticator app.",
};

// Backup codes are typed, not picked from slots, so only whitespace is
// trimmed (web's recovery input is free text, maxLength 64).
export function normalizeTwoFactorCode(code: string): string {
  return code.trim();
}

// Email/TOTP codes are complete at 6 digits (the slot input auto-submits
// there); a recovery code is submittable as soon as it is non-empty.
export function isTwoFactorCodeReady(
  method: TwoFactorMethod,
  code: string
): boolean {
  const normalized = normalizeTwoFactorCode(code);
  if (normalized.length === 0) {
    return false;
  }
  if (method === "backup") {
    return true;
  }
  return /^\d{6}$/.test(normalized);
}
