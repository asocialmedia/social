import { defineConfig } from "prisma/config";

import { keys } from "./keys";

export default defineConfig({
  datasource: {
    url: keys.DATABASE_URL,
  },
  migrations: {
    path: "prisma/migrations",
  },
  schema: "prisma/schema.prisma",
});
