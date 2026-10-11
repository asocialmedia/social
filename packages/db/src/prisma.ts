import "temporal-polyfill/full/global";
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
      // Generous on purpose, because the ceiling is not an accident of this app:
      // a den admits up to `DEN_LIMITS.membersMax` people, and every membership
      // change takes that den's claim lock, so a burst of legitimate roster writes
      // serializes into a queue behind one row. Each writer in that queue is
      // holding a connection while it waits, so the pool has to be willing to wait
      // for its turn rather than give up.
      //
      // At the 5s this used to be, that queue was not the thing being measured -
      // the wait was. A hundred-way race lost writers to
      // "timeout exceeded when trying to connect" before the lock ever got to
      // them, so the test reported a dropped write where the service had actually
      // done nothing wrong, and the same would have happened to a real owner
      // inviting a full den's worth of people at once.
      //
      // This is the pool's acquisition wait, not a query timeout: it bounds how
      // long a caller sits waiting for a connection, and nothing here caps how
      // long a statement may run once it has one.
      connectionTimeoutMillis: 30_000,
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

export { fromPrismaDateTime, toPrismaDateTime } from "./dates";

const prisma = globalThis.prismaGlobal ?? createPrismaClient();
globalThis.prismaGlobal = prisma;

export async function closePrisma(): Promise<void> {
  await prisma.close();
}

export default prisma;
