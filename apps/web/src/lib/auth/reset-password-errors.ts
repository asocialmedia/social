function getErrorCode(value: unknown): string | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("code" in value) ||
    typeof value.code !== "string"
  ) {
    return undefined;
  }
  return value.code;
}

// Only known Better Auth error codes are shown to the user. This keeps an
// upstream or infrastructure response from leaking implementation details.
export function getResetPasswordErrorMessage(payload: unknown): string {
  switch (getErrorCode(payload)) {
    case "INVALID_TOKEN": {
      return "This reset link is invalid or has expired. Request a new one and try again.";
    }
    case "PASSWORD_COMPROMISED": {
      return "This password has appeared in a data breach. Please choose a different password.";
    }
    case "PASSWORD_TOO_SHORT": {
      return "Choose a password with at least 8 characters.";
    }
    default: {
      return "Couldn't reset your password. Please try again.";
    }
  }
}
