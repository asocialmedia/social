// External protocol records keep ISO timestamps; native presentation rows use Dates.
export function parseApiJson(text: string): unknown {
  return reviveApiDates(JSON.parse(text));
}

export function reviveApiDates(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reviveApiDates);
  }
  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (record.source === "bluesky") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      key.endsWith("At") &&
      typeof item === "string" &&
      Number.isFinite(Date.parse(item))
        ? new Date(item)
        : reviveApiDates(item),
    ])
  );
}
