import { z } from "zod";

import { procedure, protectedProcedure, router } from "../../trpc";

export const userRouter = router({
  getProfile: protectedProcedure.query(({ ctx }) => ({
    user: ctx.user,
  })),

  getSession: procedure.query(({ ctx }) => ({
    session: ctx.session,
    user: ctx.user,
  })),

  updateProfile: protectedProcedure
    .input(
      z.object({
        bio: z.string().optional(),
        displayName: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) => ({
      input,
      message: "Profile update endpoint ready",
      success: true,
      userId: ctx.user.id,
    })),
});
