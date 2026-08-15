import { createAuthConfig } from "@asm/auth/core";
import type { EmailService } from "@asm/auth/core";

import { env } from "../../env";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendVerificationOTP,
} from "../email/service";

const emailService: EmailService = {
  sendPasswordResetEmail: async (email: string, token: string) => {
    const result = await sendPasswordResetEmail(email, token);
    return {
      error: result.error,
      resetUrl: result.resetUrl,
      success: result.success,
    };
  },
  sendVerificationEmail: async (email: string, token: string) => {
    const result = await sendVerificationEmail(email, token);
    return {
      error: result.error,
      success: result.success,
      verificationUrl: result.verificationUrl,
    };
  },
};

export const auth = createAuthConfig({
  emailService,
  environment: env.NODE_ENV === "test" ? "development" : env.NODE_ENV,
  sendVerificationOTP: async ({ email, otp, type }) => {
    if (type === "email-verification" || type === "change-email") {
      const result = await sendVerificationOTP(email, otp);
      if (!result.success) {
        throw new Error(result.error || "Failed to send verification OTP");
      }
      return;
    }
    throw new Error(`Unsupported verification type: ${type}`);
  },
});
