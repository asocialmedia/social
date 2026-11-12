#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/c1c1c867d8629d37906397f1f1ceaab3dfaffd156be0ed25955d90484a84ccb1/contract";
import startContract from "../../snapshots/c1c1c867d8629d37906397f1f1ceaab3dfaffd156be0ed25955d90484a84ccb1/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/f34ca42dfe00fd67ed463a9cbf170b7a8c32e6ad28d25a60f6c0a3f365765045/contract";
import endContract from "../../snapshots/f34ca42dfe00fd67ed463a9cbf170b7a8c32e6ad28d25a60f6c0a3f365765045/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: "public",
        table: "users",
        column: col("customUrls", "text[]", {
          codecRef: { codecId: "pg/text@1", many: true },
        }),
      }),
      this.addCheckConstraint({
        schema: "public",
        table: "users",
        constraint: "users_customUrls_elem_not_null_e651ac78",
        expression: 'array_position("customUrls", NULL) IS NULL',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
