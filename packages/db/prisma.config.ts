import "dotenv/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";
import { definePrismaConfig } from "prisma/config";

const config: ReturnType<typeof definePrismaConfig> = definePrismaConfig({
  orm: definePostgresConfig({
    contract: "prisma/contract.prisma",
    db: {
      connection: process.env.DATABASE_URL,
    },
    migrations: {
      dir: "prisma/migrations",
    },
    output: "generated/prisma",
  }),
});

export default config;
