import { adminRouter } from "./routers/admin";
import { authRouter } from "./routers/auth";
import { resetPasswordRouter } from "./routers/reset-password";
import { securityRouter } from "./routers/security";
import { signupRouter } from "./routers/signup";
import { userRouter } from "./routers/user";
import { router } from "./trpc";

export const appRouter = router({
  // Authentication procedures
  ...authRouter._def.procedures,

  // User management procedures
  ...userRouter._def.procedures,

  // Password reset procedures
  resetPassword: resetPasswordRouter,

  // Admin procedures
  admin: adminRouter,

  // Security procedures
  ...securityRouter._def.procedures,

  // Signup procedures
  ...signupRouter._def.procedures,
});

export type AppRouter = typeof appRouter;
