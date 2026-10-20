export function requireLoadConnectionCapacity(
  concurrency: number,
  configuredLimit?: string
): number {
  const limit = configuredLimit === undefined ? 256 : Number(configuredLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 65_535) {
    throw new Error(
      "BUN_CONFIG_MAX_HTTP_REQUESTS must be an integer from 1 to 65535"
    );
  }
  if (concurrency > limit) {
    throw new Error(
      `Start Bun with BUN_CONFIG_MAX_HTTP_REQUESTS=${concurrency} to exercise the requested concurrency without client-side queuing`
    );
  }
  return limit;
}
