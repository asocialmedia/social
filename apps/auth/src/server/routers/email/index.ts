import { z } from "zod";

import {
  notifyAccountMerged,
  notifyBackupCodesRegenerated,
  notifyEmailChanged,
  notifyMessageKeyReset,
  notifyNewClientLogin,
  notifyPasskeyChanged,
  notifyPasswordChanged,
  notifySocialAccount,
  notifyTwoFactorChanged,
  notifyUsernameChanged,
} from "../../../email/notify";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
  validateEmailServiceConfig,
} from "../../../email/service";
import { procedure, router } from "../../trpc";

const socialProvider = z.enum(["bluesky", "google", "reddit"]);
const twoFactorChange = z.enum(["disabled", "enabled", "method-changed"]);

// Account notices are advisory: each procedure returns as soon as the notice
// is queued for delivery, never surfacing a delivery failure to the caller who
// already completed the underlying action. Delivery, retries and logging are
// owned by email/notify.ts.
export const emailRouter = router({
  sendPasswordReset: procedure
    .input(
      z.object({
        email: z.email(),
        token: z.string(),
      })
    )
    .mutation(
      async ({ input }) =>
        await sendPasswordResetEmail(input.email, input.token)
    ),

  sendVerification: procedure
    .input(
      z.object({
        email: z.email(),
        token: z.string(),
      })
    )
    .mutation(
      async ({ input }) => await sendVerificationEmail(input.email, input.token)
    ),

  // --- account security notices -------------------------------------------

  notifyEmailChanged: procedure
    .input(
      z.object({
        changedAt: z.string().min(1),
        newEmail: z.email(),
        recipient: z.email(),
      })
    )
    .mutation(({ input }) => {
      notifyEmailChanged(
        input.recipient,
        { changedAt: input.changedAt, newEmail: input.newEmail },
        { source: "email-router" }
      );
      return { queued: true };
    }),

  notifyMessageKeyReset: procedure
    .input(
      z.object({
        nextStep: z.string().min(1),
        recipient: z.email(),
        resetAt: z.string().min(1),
      })
    )
    .mutation(({ input }) => {
      notifyMessageKeyReset(
        input.recipient,
        { nextStep: input.nextStep, resetAt: input.resetAt },
        { source: "email-router" }
      );
      return { queued: true };
    }),

  notifyNewClientLogin: procedure
    .input(
      z.object({
        browser: z.string().min(1),
        city: z.string().nullable(),
        country: z.string().nullable(),
        ipAddress: z.string().nullable(),
        recipient: z.email(),
        signedInAt: z.string().min(1),
      })
    )
    .mutation(({ input }) => {
      notifyNewClientLogin(
        input.recipient,
        {
          browser: input.browser,
          city: input.city,
          country: input.country,
          ipAddress: input.ipAddress,
          signedInAt: input.signedInAt,
        },
        { source: "email-router" }
      );
      return { queued: true };
    }),

  notifyPasswordChanged: procedure
    .input(
      z.object({
        changedAt: z.string().min(1),
        recipient: z.email(),
        signedOutEverywhere: z.boolean(),
      })
    )
    .mutation(({ input }) => {
      notifyPasswordChanged(
        input.recipient,
        {
          changedAt: input.changedAt,
          signedOutEverywhere: input.signedOutEverywhere,
        },
        { source: "email-router" }
      );
      return { queued: true };
    }),

  notifySocialAccount: procedure
    .input(
      z.object({
        accountName: z.string().min(1),
        action: z.enum(["linked", "unlinked"]),
        changedAt: z.string().min(1),
        provider: socialProvider,
        recipient: z.email(),
      })
    )
    .mutation(({ input }) => {
      notifySocialAccount(
        input.recipient,
        {
          accountName: input.accountName,
          action: input.action,
          changedAt: input.changedAt,
          provider: input.provider,
        },
        { source: "email-router" }
      );
      return { queued: true };
    }),

  notifyTwoFactorChanged: procedure
    .input(
      z.object({
        change: twoFactorChange,
        changedAt: z.string().min(1),
        method: z.string().min(1),
        recipient: z.email(),
      })
    )
    .mutation(({ input }) => {
      notifyTwoFactorChanged(
        input.recipient,
        {
          change: input.change,
          changedAt: input.changedAt,
          method: input.method,
        },
        { source: "email-router" }
      );
      return { queued: true };
    }),

  notifyAccountMerged: procedure
    .input(
      z.object({
        completedAt: z.string().min(1),
        keptUsername: z.string().min(1),
        mode: z.enum(["discard", "merge"]),
        recipient: z.email(),
        removedUsername: z.string().min(1),
      })
    )
    .mutation(({ input }) => {
      const { recipient, ...rest } = input;
      notifyAccountMerged(recipient, rest, { source: "email-router" });
      return { queued: true };
    }),

  notifyBackupCodesRegenerated: procedure
    .input(
      z.object({
        changedAt: z.string().min(1),
        codeCount: z.number().int().positive(),
        recipient: z.email(),
      })
    )
    .mutation(({ input }) => {
      notifyBackupCodesRegenerated(
        input.recipient,
        { changedAt: input.changedAt, codeCount: input.codeCount },
        { source: "email-router" }
      );
      return { queued: true };
    }),

  notifyPasskeyChanged: procedure
    .input(
      z.object({
        action: z.enum(["added", "removed"]),
        changedAt: z.string().min(1),
        passkeyName: z.string().min(1),
        recipient: z.email(),
      })
    )
    .mutation(({ input }) => {
      notifyPasskeyChanged(
        input.recipient,
        {
          action: input.action,
          changedAt: input.changedAt,
          passkeyName: input.passkeyName,
        },
        { source: "email-router" }
      );
      return { queued: true };
    }),

  notifyUsernameChanged: procedure
    .input(
      z.object({
        changedAt: z.string().min(1),
        previousUsername: z.string().min(1),
        previousUsernameExpiresAt: z.string().min(1),
        recipient: z.email(),
        username: z.string().min(1),
      })
    )
    .mutation(({ input }) => {
      notifyUsernameChanged(
        input.recipient,
        {
          changedAt: input.changedAt,
          previousUsername: input.previousUsername,
          previousUsernameExpiresAt: input.previousUsernameExpiresAt,
          username: input.username,
        },
        { source: "email-router" }
      );
      return { queued: true };
    }),

  validateConfig: procedure.query(() => validateEmailServiceConfig()),
});

export type EmailRouter = typeof emailRouter;
