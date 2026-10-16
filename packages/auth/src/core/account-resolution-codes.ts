import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from "better-auth/api";
import { z } from "zod";

import { recoveryEmail } from "../validation/account-identity";
import { accountResolutionStore } from "./account-resolution-state";
import type { AccountResolutionStore } from "./account-resolution-state";

const bodySchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.trim().toLowerCase()),
  id: z.uuid(),
  otp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  side: z.enum(["current", "other", "collision"]),
});

export function accountResolutionCodes(
  sendCode:
    | ((params: {
        email: string;
        otp: string;
        type: string;
      }) => Promise<void> | void)
    | undefined,
  store: AccountResolutionStore = accountResolutionStore
): BetterAuthPlugin {
  return {
    endpoints: {
      accountResolutionCode: createAuthEndpoint(
        "/account-resolution/code",
        {
          body: bodySchema,
          method: "POST",
        },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          const pending = await store.read(ctx.body.id);
          if (
            !session ||
            !pending ||
            pending.state.userId !== session.user.id ||
            pending.state.sessionId !== session.session.id
          ) {
            throw new APIError("UNAUTHORIZED", {
              message:
                "This account review has expired. Start again from settings.",
            });
          }
          const { state, serialized } = pending;
          const { side, email, otp, id } = ctx.body;
          if (state.attempts >= 20 || !sendCode) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Start a new account review to continue.",
            });
          }
          if (side === "collision") {
            if (
              state.kind !== "email" ||
              state.email !== email ||
              state.identityVerified
            ) {
              throw new APIError("BAD_REQUEST", {
                message: "Invalid email verification request.",
              });
            }
          } else {
            if (!state.identityVerified || !state.otherUserId) {
              throw new APIError("FORBIDDEN", {
                message: "Verify the other account first.",
              });
            }
            const userId =
              side === "current" ? state.userId : state.otherUserId;
            const user = await ctx.context.internalAdapter.findUserById(userId);
            if (
              !user ||
              (recoveryEmail(user.email) && user.email.toLowerCase() !== email)
            ) {
              throw new APIError("BAD_REQUEST", {
                message: "Use this account's existing email address.",
              });
            }
            const owner =
              await ctx.context.internalAdapter.findUserByEmail(email);
            if (owner && owner.user.id !== userId) {
              throw new APIError("CONFLICT", {
                message:
                  "Choose an email address that is not used by another account.",
              });
            }
          }
          const digest = (code: string) =>
            createHmac("sha256", ctx.context.secret)
              .update(`${id}:${side}:${email}:${code}`)
              .digest("hex");
          if (!otp) {
            const existing = state.codes[side];
            if (existing && existing.expiresAt - 240_000 > Date.now()) {
              throw new APIError("TOO_MANY_REQUESTS", {
                message: "Wait a minute before requesting another code.",
              });
            }
            const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
            const next = {
              ...state,
              attempts: state.attempts + 1,
              codes: {
                ...state.codes,
                [side]: {
                  attempts: 0,
                  digest: digest(code),
                  email,
                  expiresAt: Date.now() + 300_000,
                },
              },
            };
            if (!(await store.update(id, serialized, next))) {
              throw new APIError("CONFLICT", {
                message: "This review changed. Try again.",
              });
            }
            await sendCode({ email, otp: code, type: "email-verification" });
            return ctx.json({ success: true });
          }
          const code = state.codes[side];
          if (
            !code ||
            code.email !== email ||
            code.expiresAt <= Date.now() ||
            code.attempts >= 3
          ) {
            throw new APIError("BAD_REQUEST", {
              message: "This code expired. Request another one.",
            });
          }
          const valid = timingSafeEqual(
            Buffer.from(code.digest, "hex"),
            Buffer.from(digest(otp), "hex")
          );
          const next = {
            ...state,
            attempts: state.attempts + 1,
            codes: { ...state.codes },
          };
          if (valid) {
            next.codes = Object.fromEntries(
              Object.entries(next.codes).filter(([key]) => key !== side)
            );
            if (side === "collision") {
              next.identityVerified = true;
            } else {
              next.setupEmails = { ...state.setupEmails, [side]: email };
            }
          } else {
            next.codes[side] = { ...code, attempts: code.attempts + 1 };
          }
          if (!(await store.update(id, serialized, next))) {
            throw new APIError("CONFLICT", {
              message: "This review changed. Try again.",
            });
          }
          if (!valid) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid verification code.",
            });
          }
          return ctx.json({ success: true });
        }
      ),
    },
    id: "account-resolution-codes",
  };
}
