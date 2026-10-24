// OAuth placeholders identify a provider account; they cannot receive mail.
export function recoveryEmail(email: string | null | undefined): string | null {
  const value = email?.trim();
  if (!value) {
    return null;
  }
  const separator = value.lastIndexOf("@");
  if (separator < 1 || separator === value.length - 1) {
    return null;
  }
  const domain = value.slice(separator + 1).toLowerCase();
  return domain === "invalid" ||
    domain.endsWith(".invalid") ||
    domain.endsWith(".local")
    ? null
    : value;
}

export function hasCredentialPassword(
  userId: string,
  accounts: readonly {
    accountId: string;
    password?: string | null;
    providerId: string;
  }[]
): boolean {
  return accounts.some(
    (account) =>
      account.providerId === "credential" &&
      account.accountId === userId &&
      typeof account.password === "string" &&
      account.password.length > 0
  );
}

export function accountLinkErrorMessage(code: string): string {
  const normalized = code.toLowerCase();
  if (
    [
      "account_ownership_conflict",
      "account_already_linked_to_different_user",
      "social_account_already_linked",
    ].includes(normalized)
  ) {
    return "That provider belongs to another asocialmedia account. Sign in to that account to manage it.";
  }
  if (
    ["failed_to_unlink_last_account", "cannot_unlink_last_method"].includes(
      normalized
    )
  ) {
    return "Keep another working sign-in method before disconnecting this one.";
  }
  if (
    [
      "account_not_linked",
      "username_is_already_taken",
      "oauth_email_not_verified",
    ].includes(normalized)
  ) {
    return "Sign in to your existing asocialmedia account, then connect this provider in Settings.";
  }
  if (["access_denied", "provider_flow_failed"].includes(normalized)) {
    return "The provider did not complete account linking. Please try again.";
  }
  if (["state_mismatch", "please_restart_the_process"].includes(normalized)) {
    return "That connection request expired. Please try again.";
  }
  return "Couldn't connect that account. Please try again.";
}

export function hasLinkedProvider(
  accounts: unknown,
  provider: string
): boolean {
  return (
    Array.isArray(accounts) &&
    accounts.some(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        "providerId" in entry &&
        entry.providerId === provider
    )
  );
}
