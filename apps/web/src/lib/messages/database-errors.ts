// Prisma 8 exposes SQLSTATE on SqlQueryError and keeps the driver in its cause.
export function isUniqueConstraintViolation(error: unknown): boolean {
  let candidate = error;
  const visited = new Set<object>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      visited.has(candidate)
    ) {
      return false;
    }
    visited.add(candidate);
    if ("sqlState" in candidate && candidate.sqlState === "23505") {
      return true;
    }
    if (
      "code" in candidate &&
      (candidate.code === "23505" || candidate.code === "P2002")
    ) {
      return true;
    }
    candidate = "cause" in candidate ? candidate.cause : undefined;
  }
  return false;
}
