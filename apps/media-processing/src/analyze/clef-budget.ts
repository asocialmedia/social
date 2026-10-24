// Paid inference requires an explicit opt-in; malformed configuration keeps the free ceiling.
export function resolveClefDailyBudget(value: unknown, paidEnabled: unknown) {
  const parsed = Number(value);
  const limit = paidEnabled === "1" ? 1_000_000 : 10_000;
  return Number.isSafeInteger(parsed) && parsed >= 1
    ? Math.min(limit, parsed)
    : 9000;
}
