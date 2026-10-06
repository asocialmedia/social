#!/usr/bin/env -S node
import { Migration, MigrationCLI } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/b710be6a3e5e6e7f6accdce53c224fd887cd0be330a69146799ef246c4f79df9/contract";
import startContract from "../../snapshots/b710be6a3e5e6e7f6accdce53c224fd887cd0be330a69146799ef246c4f79df9/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/c2b37d44c45891f704d244735fb801e82788e4202253dc4fec099733ce5b7a23/contract";
import endContract from "../../snapshots/c2b37d44c45891f704d244735fb801e82788e4202253dc4fec099733ce5b7a23/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    // User deletion (GDPR/account-delete) was blocked by RESTRICT FKs:
    // DELETE FROM users failed with "violates RESTRICT setting of foreign
    // key constraint aura_logs_userId_fkey". Only the deleted user's own
    // rows cascade; no other user's data is touched. Postgres rewrites the
    // FK action in place - no data rewrite, metadata-only DDL.
    return [
      this.dropConstraint({
        schema: "public",
        table: "aura_logs",
        constraint: "aura_logs_userId_fkey",
      }),
      this.dropConstraint({
        schema: "public",
        table: "aura_logs",
        constraint: "aura_logs_issuerId_fkey",
      }),
      this.dropConstraint({
        schema: "public",
        table: "HNBookmark",
        constraint: "HNBookmark_userId_fkey",
      }),
      this.addForeignKey({
        schema: "public",
        table: "aura_logs",
        foreignKey: {
          name: "aura_logs_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "aura_logs",
        foreignKey: {
          name: "aura_logs_issuerId_fkey",
          columns: ["issuerId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "HNBookmark",
        foreignKey: {
          name: "HNBookmark_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
