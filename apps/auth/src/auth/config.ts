import { createAuthConfig, type EmailService } from "@asm/auth/core";
import { env } from "../../env";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendVerificationOTP,
} from "../email/service";

const emailService: EmailService = {
  sendVerificationEmail: async (email: string, token: string) => {
    const result = await sendVerificationEmail(email, token);
    return {
      success: result.success,
      error: result.error,
      verificationUrl: result.verificationUrl,
    };
  },
  sendPasswordResetEmail: async (email: string, token: string) => {
    const result = await sendPasswordResetEmail(email, token);
    return {
      success: result.success,
      error: result.error,
      resetUrl: result.resetUrl,
    };
  },
};

export const auth = createAuthConfig({
  emailService,
  environment: env.NODE_ENV === "test" ? "development" : env.NODE_ENV,
  sendVerificationOTP: async ({ email, otp, type }) => {
    if (type === "email-verification") {
      const result = await sendVerificationOTP(email, otp);
      if (!result.success) {
        throw new Error(result.error || "Failed to send verification OTP");
      }
      return;
    }
    throw new Error(`Unsupported verification type: ${type}`);
  },
});
