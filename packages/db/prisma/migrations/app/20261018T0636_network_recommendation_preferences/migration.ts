#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  lit,
} from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/1b7aa6731e6317642df582a77c348cacbdc6b0dc385ae14a5322115db5fdd7ba/contract";
import startContract from "../../snapshots/1b7aa6731e6317642df582a77c348cacbdc6b0dc385ae14a5322115db5fdd7ba/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/feccf7a05ebbcd758ed6dcc7123258aba4f9ec9ee462138ff17a96901680ca31/contract";
import endContract from "../../snapshots/feccf7a05ebbcd758ed6dcc7123258aba4f9ec9ee462138ff17a96901680ca31/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: "public",
        table: "users",
        column: col("networkPreferences", "jsonb", {
          codecRef: { codecId: "pg/jsonb@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "users",
        column: col("networkPreferencesRevision", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
