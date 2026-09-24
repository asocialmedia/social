import postgres from "@prisma/orm-postgres/runtime";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";

import type { Contract } from "../generated/prisma/contract";
import contractJson from "../generated/prisma/contract.json" with { type: "json" };
import { keys } from "../keys";

declare global {
  var prismaGlobal: undefined | PrismaClient;
}

function createPrismaClient(): PrismaClient {
  return postgres<Contract>({
    contractJson,
    poolOptions: {
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 60_000,
    },
    url: keys.DATABASE_URL,
  });
}

export type PrismaClient = PostgresClient<Contract>;
export type PrismaOrm = PrismaClient["orm"];
export type PrismaTransaction = Parameters<
  Parameters<PrismaClient["transaction"]>[0]
>[0];

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

const prisma = globalThis.prismaGlobal ?? createPrismaClient();
globalThis.prismaGlobal = prisma;

export async function closePrisma(): Promise<void> {
  await prisma.close();
}

export default prisma;
