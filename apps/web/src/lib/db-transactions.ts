import { prisma, Prisma } from "@asm/db";

// Aura-mutating transactions must not run at PostgreSQL's default READ
// COMMITTED isolation: two concurrent writers can both read the pre-race
// state and both apply the same delta (double aura, duplicate ledger rows).
// SERIALIZABLE makes a losing writer abort with P2034; this helper retries a
// bounded number of times so a legitimate concurrent vote converges instead
// of failing.
function isSerializationConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2034"
  );
}

export async function runSerializableTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { maxAttempts?: number } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  let lastError: unknown = new Error("transaction did not run");
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- serialization retries are inherently sequential: each attempt re-runs only after the previous one aborts
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15_000,
      });
    } catch (error) {
      lastError = error;
      if (!isSerializationConflict(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }
  throw lastError;
}
