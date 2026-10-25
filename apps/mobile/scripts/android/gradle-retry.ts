// Bun shell errors carry command diagnostics separately from their message.
function gradleFailureText(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return String(error);
  }
  const failure = error as {
    message?: unknown;
    stderr?: unknown;
    stdout?: unknown;
  };
  return [failure.message, failure.stderr, failure.stdout]
    .map((part) =>
      typeof part === "string" || Buffer.isBuffer(part) ? part.toString() : ""
    )
    .join("\n");
}

export function isGradleResolutionFailure(error: unknown): boolean {
  return /was not found in any of the following sources|could not resolve (?:plugin artifact|all files|.*artifact)/i.test(
    gradleFailureText(error)
  );
}
