import { prisma } from "@asm/db";
import type { PrismaTransaction } from "@asm/db";

export class TransactionRetryError extends Error {
  constructor() {
    super("transaction retry");
    this.name = "TransactionRetryError";
  }
}

function isTransactionRetry(error: unknown): boolean {
  if (error instanceof TransactionRetryError) {
    return true;
  }
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const { code } = error as { code?: string };
  return code === "P2002" || code === "P2034";
}

async function runTransactionAttempt<T>(
  fn: (tx: PrismaTransaction) => Promise<T>,
  maxAttempts: number,
  attempt: number
): Promise<T> {
  try {
    return await prisma.transaction(fn);
  } catch (error) {
    if (!isTransactionRetry(error) || attempt === maxAttempts) {
      throw error;
    }
    return runTransactionAttempt(fn, maxAttempts, attempt + 1);
  }
}

export function runSerializableTransaction<T>(
  fn: (tx: PrismaTransaction) => Promise<T>,
  options: { maxAttempts?: number } = {}
): Promise<T> {
  return runTransactionAttempt(fn, Math.max(1, options.maxAttempts ?? 4), 1);
}
