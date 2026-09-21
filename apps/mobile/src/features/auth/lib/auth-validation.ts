// Field validation for the auth screens, backed by the SAME zod schemas the
// web forms use (@asm/auth/validation), so rules and copy cannot drift. The
// screens want one message per field, so this adapts safeParse to that shape.

import {
  EMAIL_REGEX,
  USERNAME_REGEX,
  newPasswordSchema,
  signUpSchema,
} from "@asm/auth/validation";

export { EMAIL_REGEX, USERNAME_REGEX } from "@asm/auth/validation";

export interface SignupErrors {
  email?: string;
  password?: string;
  username?: string;
}

interface ParseOutcome {
  error?: { issues: readonly { message: string }[] };
  success: boolean;
}

// The first issue is the most specific one the user can act on: the schemas
// order their checks required -> shape -> strength, like the web forms.
function firstIssue(outcome: ParseOutcome): string | undefined {
  return outcome.success ? undefined : outcome.error?.issues[0]?.message;
}

export function validateUsername(username: string): string | undefined {
  return firstIssue(signUpSchema.shape.username.safeParse(username));
}

export function validateSignupEmail(email: string): string | undefined {
  return firstIssue(signUpSchema.shape.email.safeParse(email));
}

export function validateNewPassword(password: string): string | undefined {
  return firstIssue(newPasswordSchema.safeParse(password));
}

export function validateSignup(
  username: string,
  email: string,
  password: string
): SignupErrors {
  const errors: SignupErrors = {};
  const usernameError = validateUsername(username);
  const emailError = validateSignupEmail(email);
  const passwordError = validateNewPassword(password);
  if (usernameError) {
    errors.username = usernameError;
  }
  if (emailError) {
    errors.email = emailError;
  }
  if (passwordError) {
    errors.password = passwordError;
  }
  return errors;
}

// Login accepts either identifier; the web loginSchema only requires a value,
// so the shape check here is a UX nicety rather than a rule to keep in sync.
export function validateIdentifier(identifier: string): string | undefined {
  const value = identifier.trim();
  if (!value) {
    return "Please enter your username or email address";
  }
  if (EMAIL_REGEX.test(value) || USERNAME_REGEX.test(value)) {
    return undefined;
  }
  return "Please enter a valid email address or username";
}
