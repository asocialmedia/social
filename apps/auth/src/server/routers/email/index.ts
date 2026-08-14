import { z } from "zod";

import {
  sendPasswordResetEmail,
  sendVerificationEmail,
  validateEmailServiceConfig,
} from "../../../email/service";
import { procedure, router } from "../../trpc";

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

  validateConfig: procedure.query(() => validateEmailServiceConfig()),
});

export type EmailRouter = typeof emailRouter;
