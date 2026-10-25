#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";
import postgres from "@prisma/orm-postgres/runtime";

import type { Contract as Start } from "../../snapshots/a3ba1e560e658ad38ccb06e359f66cb96aafd975ba3225f0ee69c28f3e1280b5/contract";
import startContract from "../../snapshots/a3ba1e560e658ad38ccb06e359f66cb96aafd975ba3225f0ee69c28f3e1280b5/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/c6d9eac560b0b36f4403509474767fd956b7d77d370f09b2c40ac0c6276f56d5/contract";
import endContract from "../../snapshots/c6d9eac560b0b36f4403509474767fd956b7d77d370f09b2c40ac0c6276f56d5/contract.json" with { type: "json" };
const { sql: db, contract } = postgres<End>({ contractJson: endContract });

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: "public",
        table: "external_engagements",
        column: col("amplifiedAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      // Historical amplification times were not stored; the first engagement is a stable estimate.
      this.dataTransform(
        contract,
        "backfill-external_engagements-amplifiedAt",
        {
          check: () =>
            db.public.external_engagements
              .select("userId")
              .where((fields, fns) => fns.eq(fields.amplifiedAt, null))
              .limit(1),
          run: () =>
            db.public.external_engagements
              .update((fields) => ({ amplifiedAt: fields.createdAt }))
              .where((fields, fns) => fns.eq(fields.amplifiedAt, null)),
        }
      ),
      this.setNotNull({
        schema: "public",
        table: "external_engagements",
        column: "amplifiedAt",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
