#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  lit,
} from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/c2e04192b3a88b216d810715c83bac4591323697224e45771671dfd9ba9c2dc4/contract";
import startContract from "../../snapshots/c2e04192b3a88b216d810715c83bac4591323697224e45771671dfd9ba9c2dc4/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/e0db41f797b37e7ade1a45f9deae388795d20087c07f19a72dc45dd334e5c5a1/contract";
import endContract from "../../snapshots/e0db41f797b37e7ade1a45f9deae388795d20087c07f19a72dc45dd334e5c5a1/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("membershipSeq", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
