import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import {
  addOAuthServerContext,
  APIError,
  createAuthMiddleware,
  getOAuthState,
  getSessionFromCtx,
} from "better-auth/api";

import { validateOAuthIdentity } from "./account-linking-policy";
import {
  accountResolutionStore,
  newAccountResolutionState,
} from "./account-resolution-state";
import type { AccountResolutionStore } from "./account-resolution-state";

type UserValidation = NonNullable<
  NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]
>;

// A provider callback can prove ownership without reassigning its existing account.
export function accountCollisionProtection(
  store: AccountResolutionStore = accountResolutionStore
) {
  let findOwner:
    | ((provider: string, accountId: string) => Promise<string | null>)
    | undefined;
  let sessionIsActive:
    | ((sessionId: string, userId: string) => Promise<boolean>)
    | undefined;
  let findEmailOwner: ((email: string) => Promise<string | null>) | undefined;

  const validate: UserValidation = async (input, context) => {
    const invalid = await validateOAuthIdentity(input, context);
    if (invalid) {
      return invalid;
    }
    if (
      input.source.action !== "link-account" ||
      input.source.method !== "oauth"
    ) {
      return;
    }
    const state = await getOAuthState();
    const id = state?.serverContext?.accountResolutionId;
    const provider = input.source.oauth?.providerId;
    if (
      typeof id !== "string" ||
      !state?.link ||
      !findOwner ||
      (provider !== "google" && provider !== "reddit")
    ) {
      return {
        error: "link_confirmation_required",
        errorDescription: "Start account linking again from settings.",
      };
    }
    const pending = await store.read(id);
    if (
      !pending ||
      pending.state.userId !== state.link.userId ||
      pending.state.provider !== provider ||
      !sessionIsActive ||
      !(await sessionIsActive(pending.state.sessionId, pending.state.userId))
    ) {
      return {
        error: "link_confirmation_required",
        errorDescription: "This account linking request has expired.",
      };
    }
    const profile = input.source.oauth?.profile;
    const subject = provider === "google" ? profile?.sub : profile?.id;
    if (typeof subject !== "string" && typeof subject !== "number") {
      return {
        error: "invalid_provider_identity",
        errorDescription:
          "The provider did not return a valid account identity.",
      };
    }
    const providerOwner = await findOwner(provider, String(subject));
    const owner =
      providerOwner ??
      (provider === "google" && typeof profile?.email === "string"
        ? await findEmailOwner?.(profile.email)
        : null);
    if (!owner || owner === state.link.userId) {
      return;
    }
    const saved = await store.update(id, pending.serialized, {
      ...pending.state,
      identityVerified: true,
      otherUserId: owner,
      providerAccountId: String(subject),
      providerOwnerId: providerOwner,
    });
    return {
      error: saved ? "account_collision" : "link_confirmation_required",
      errorDescription:
        "This sign-in method belongs to another account. Review both accounts before continuing.",
    };
  };

  const plugin: BetterAuthPlugin = {
    hooks: {
      before: [
        {
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            const provider = ctx.body?.provider;
            if (!session || (provider !== "google" && provider !== "reddit")) {
              return;
            }
            // Direct ID-token linking has no state callback; reject instead of bypassing collision checks.
            if (ctx.body?.idToken) {
              throw new APIError("BAD_REQUEST", {
                code: "link_confirmation_required",
                message: "Connect this provider through settings.",
              });
            }
            const id = crypto.randomUUID();
            await store.create(
              id,
              newAccountResolutionState(session.user.id, session.session.id, {
                kind: "oauth",
                provider,
              })
            );
            const callback = new URL(
              ctx.body.errorCallbackURL || ctx.body.callbackURL || "/settings",
              ctx.context.baseURL
            );
            callback.searchParams.set("account_collision", id);
            ctx.body.errorCallbackURL = callback.toString();
            await addOAuthServerContext({ accountResolutionId: id });
          }),
          matcher: (ctx) => ctx.path === "/link-social",
        },
      ],
    },
    id: "account-collision-protection",
    init(context) {
      findEmailOwner = async (email) => {
        const owner = await context.internalAdapter.findUserByEmail(email);
        return owner?.user.id ?? null;
      };
      sessionIsActive = async (sessionId, userId) => {
        const session = await context.adapter.findOne<{ expiresAt: Date }>({
          model: "session",
          where: [
            { field: "id", value: sessionId },
            { field: "userId", value: userId },
          ],
        });
        return Boolean(
          session && new Date(session.expiresAt).getTime() > Date.now()
        );
      };
      findOwner = async (providerId, accountId) => {
        const account = await context.adapter.findOne<{ userId: string }>({
          model: "account",
          where: [
            { field: "providerId", value: providerId },
            { field: "accountId", value: accountId },
          ],
        });
        return account?.userId ?? null;
      };
      return {
        options: {
          databaseHooks: {
            account: {
              update: {
                before(account) {
                  if (account.userId) {
                    throw new APIError("FORBIDDEN", {
                      message:
                        "Account ownership changes require a verified account review.",
                    });
                  }
                  return Promise.resolve();
                },
              },
            },
          },
        },
      };
    },
  };
  return { plugin, validate };
}
