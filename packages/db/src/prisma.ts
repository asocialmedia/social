import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { keys } from "../keys";
import { PrismaClient } from "../prisma/generated/prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: undefined | PrismaClient;
  // eslint-disable-next-line no-var
  var pgPoolGlobal: undefined | Pool;
}

function getOrCreatePool(): Pool {
  if (globalThis.pgPoolGlobal) {
    return globalThis.pgPoolGlobal;
  }

  const pool = new Pool({
    connectionString: keys.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 60_000,
    keepAlive: true,
    max: 20,
  });

  globalThis.pgPoolGlobal = pool;
  return pool;
}

function createPrismaClient(): PrismaClient {
  const pool = getOrCreatePool();
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// Preserve singletons on globalThis in all environments so Next.js standalone
// route handler bundles share the same connection pool and Prisma instance.
const prisma = globalThis.prismaGlobal ?? createPrismaClient();
globalThis.prismaGlobal = prisma;

export default prisma;
