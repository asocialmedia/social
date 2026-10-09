// The facts the settings tabs read, derived from the session user rather than
// fetched separately, so the tabs cannot disagree with the signed-in identity
// the rest of the app already has.

export interface AccountFacts {
  canLinkProviders: boolean;
  email: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  hasReddit: boolean;
  linkedProviders: string[];
  username: string;
}

interface SessionUserLike {
  accounts?: unknown;
  email?: string | null;
  emailVerified?: boolean;
  id: string;
  image?: string | null;
  name?: string | null;
  username?: string | null;
}

function providerIds(user: SessionUserLike): string[] {
  if (!Array.isArray(user.accounts)) {
    return [];
  }
  return user.accounts.flatMap((account) => {
    if (typeof account !== "object" || account === null) {
      return [];
    }
    const { providerId } = account as { providerId?: unknown };
    return typeof providerId === "string" ? [providerId] : [];
  });
}

// Web gates connecting another provider on a verified email AND a password, so
// a newly linked provider can never become the only way back in. The password
// itself is never exposed, so its presence is inferred from a credential entry
// rather than a boolean on the user.
function hasPassword(user: SessionUserLike): boolean {
  if (!Array.isArray(user.accounts)) {
    // With no account list to inspect, assume a password exists: a false
    // negative would show a redundant "add a password" form, while a false
    // positive only hides it.
    return true;
  }
  return user.accounts.some((account) => {
    if (typeof account !== "object" || account === null) {
      return false;
    }
    const { providerId } = account as { providerId?: unknown };
    return providerId === "credential";
  });
}

export function accountFactsFrom(user: SessionUserLike | null): AccountFacts {
  const email = user?.email ?? null;
  const emailVerified = user?.emailVerified === true;
  const password = hasPassword(user ?? { id: "" });
  const providers = providerIds(user ?? { id: "" });
  return {
    canLinkProviders: emailVerified && password,
    email,
    emailVerified,
    hasPassword: password,
    // Web prompts a recovery email for Reddit-only accounts (`user.redditId`),
    // which is the same as having a reddit provider and no address.
    hasReddit: providers.includes("reddit"),
    linkedProviders: providers,
    username: user?.username || user?.name || "",
  };
}

// The session payload does not always carry the accounts relation, so the
// settings screen reads the authoritative server state (better-auth's
// account rows plus the verified TOTP row) and merges it in. Web reads the
// same rows server-side in `settings/page.tsx`; native cannot, so it asks the
// security-state route.
export interface LinkedAccountInfo {
  hasPassword: boolean;
  linkedProviders: string[];
}

// Merges the authoritative account rows onto the session-derived facts.
export function withLinkedAccounts(
  facts: AccountFacts,
  accounts: LinkedAccountInfo
): AccountFacts {
  return {
    ...facts,
    canLinkProviders: facts.emailVerified && accounts.hasPassword,
    hasPassword: accounts.hasPassword,
    hasReddit: accounts.linkedProviders.includes("reddit"),
    linkedProviders: accounts.linkedProviders,
  };
}
