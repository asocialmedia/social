#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  lit,
} from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/2820a467349490a407b724112822741f1a10f3adb12464ceef6628debfc648ed/contract";
import startContract from "../../snapshots/2820a467349490a407b724112822741f1a10f3adb12464ceef6628debfc648ed/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/a50a7555eb8b3c15d8150f64247d6bccf10c6ad5b693d7f87a35eb8cc203a80e/contract";
import endContract from "../../snapshots/a50a7555eb8b3c15d8150f64247d6bccf10c6ad5b693d7f87a35eb8cc203a80e/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "message_search_coverage",
        column: col("hasUnreadableMessages", "bool", {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: "pg/bool@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_search_coverage",
        column: col("unrecoverableEpochIds", "int4[]", {
          notNull: true,
          default: lit([]),
          codecRef: { codecId: "pg/int4@1", many: true },
        }),
      }),
      this.addCheckConstraint({
        schema: "public",
        table: "message_search_coverage",
        constraint:
          "message_search_coverage_unrecoverableEpochIds_elem_not_b41414ee",
        expression: 'array_position("unrecoverableEpochIds", NULL) IS NULL',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
