import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";

import {
  hasCredentialPassword,
  recoveryEmail,
} from "../../validation/account-identity";

type AccountLinking = NonNullable<
  NonNullable<BetterAuthOptions["account"]>["accountLinking"]
>;
type UserValidation = NonNullable<
  NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]
>;

export const ACCOUNT_LINKING_POLICY = {
  allowDifferentEmails: true,
  allowUnlinkingAll: false,
  disableImplicitLinking: true,
  enabled: true,
  requireLocalEmailVerified: true,
  updateUserInfoOnLink: false,
} satisfies AccountLinking;

export const validateOAuthIdentity: UserValidation = ({ user, source }) => {
  const email =
    source.action === "link-account" && source.oauth?.providerId === "google"
      ? source.oauth.profile?.email
      : user.email;
  if (
    source.method === "oauth" &&
    source.oauth?.providerId === "google" &&
    (typeof email !== "string" || !recoveryEmail(email) || !user.emailVerified)
  ) {
    return {
      error: "oauth_email_not_verified",
      errorDescription: "Verify your Google email before using it to sign in.",
    };
  }
};

// Apply the lockout check at the shared auth boundary, including native clients.
export function protectLastSignInMethod(): BetterAuthPlugin {
  return {
    id: "protect-last-sign-in-method",
    init(context) {
      return {
        options: {
          databaseHooks: {
            account: {
              delete: {
                async before(account, endpoint) {
                  if (endpoint?.path !== "/unlink-account") {
                    return;
                  }
                  const [user, accounts] = await Promise.all([
                    context.internalAdapter.findUserById(account.userId),
                    context.internalAdapter.findAccounts(account.userId),
                  ]);
                  const remaining = accounts.filter(
                    (entry) => entry.id !== account.id
                  );
                  const social = remaining.some((entry) =>
                    ["google", "reddit"].includes(entry.providerId)
                  );
                  const password =
                    user?.emailVerified &&
                    recoveryEmail(user.email) &&
                    hasCredentialPassword(account.userId, remaining);
                  if (!social && !password) {
                    throw new APIError("BAD_REQUEST", {
                      code: "cannot_unlink_last_method",
                      message:
                        "Keep another working sign-in method before disconnecting this one.",
                    });
                  }
                },
              },
            },
          },
        },
      };
    },
  };
}
