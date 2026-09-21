// UI-only validation mirroring packages/auth/src/validation/schemas.ts.
// No API calls here. Error copy matches the web forms 1:1 so the mobile
// screens read exactly like apps/web.

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

const THREEPEAT_REGEX = /(?<char>.)\k<char>{2,}/;
const COMMON_SEQUENCE_REGEX = /(?:abc|123|qwe|xyz)/i;
const COMMON_WORDS = ["password", "admin", "user", "login"];

export interface SignupErrors {
  email?: string;
  password?: string;
  username?: string;
}

export function validateUsername(username: string): string | undefined {
  const value = username.trim();
  if (!value) {
    return "Username is required, pick something cool!";
  }
  if (!USERNAME_REGEX.test(value)) {
    return "Username can only contain letters, numbers, and underscores (no weird symbols pls)";
  }
  if (value.toLowerCase() === "zeph") {
    return "That username is taken, try something else";
  }
  return undefined;
}

export function validateSignupEmail(email: string): string | undefined {
  const value = email.trim();
  if (!value) {
    return "Email is required, we need to reach you!";
  }
  if (!EMAIL_REGEX.test(value)) {
    return "Please enter a valid email address";
  }
  return undefined;
}

export function validateNewPassword(password: string): string | undefined {
  if (!password.trim()) {
    return "Password is required, keep it safe!";
  }
  if (password.length < 8) {
    return "Password needs at least 8 characters, keep it 100";
  }
  if (!/[A-Z]/.test(password)) {
    return "Need at least one uppercase letter (be fancy!)";
  }
  if (!/[a-z]/.test(password)) {
    return "Need at least one lowercase letter (keep it real!)";
  }
  if (!/[0-9]/.test(password)) {
    return "Need at least one number (math time!)";
  }
  if (!/[@$!%*?&#]/.test(password)) {
    return "Need at least one special character (be spicy!)";
  }
  if (THREEPEAT_REGEX.test(password)) {
    return "No spamming the same letter 3+ times (that's not cute anymore)";
  }
  if (COMMON_SEQUENCE_REGEX.test(password)) {
    return "ABC or 123? Nah, be more creative than that!";
  }
  if (COMMON_WORDS.some((word) => password.toLowerCase().includes(word))) {
    return "'password123' is so last season, pick something better!";
  }
  return undefined;
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
