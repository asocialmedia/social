interface AuthClientError {
  message?: string;
  status?: number;
}

function isAuthClientError(error: unknown): error is AuthClientError {
  return typeof error === "object" && error !== null;
}

export function requiresFreshSession(error: unknown): boolean {
  if (!isAuthClientError(error)) {
    return false;
  }

  return (
    error.status === 403 &&
    error.message?.toLowerCase().includes("fresh") === true
  );
}
