export function toPrismaDateTime(value: Date): Temporal.PlainDateTime {
  return Temporal.PlainDateTime.from(value.toISOString().replace("Z", ""));
}

export function fromPrismaDateTime(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toZonedDateTime" in value
  ) {
    const plainDateTime = value as {
      toZonedDateTime: (timeZone: string) => { epochMilliseconds: number };
    };
    return new Date(plainDateTime.toZonedDateTime("UTC").epochMilliseconds);
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new TypeError("Expected a Prisma 8 temporal value");
}
