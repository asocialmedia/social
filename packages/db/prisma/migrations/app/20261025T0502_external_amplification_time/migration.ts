#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";
import postgres from "@prisma/orm-postgres/runtime";

import type { Contract as End } from "../../snapshots/da193d30e4b244befee8f188be74d8b355350db2e201bdee5f340df943bec4f0/contract";
import endContract from "../../snapshots/da193d30e4b244befee8f188be74d8b355350db2e201bdee5f340df943bec4f0/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/e5e50f0b7714b63f67e04423b02c183ad20bf9eaf36fb535e6235e7430090bfc/contract";
import startContract from "../../snapshots/e5e50f0b7714b63f67e04423b02c183ad20bf9eaf36fb535e6235e7430090bfc/contract.json" with { type: "json" };
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
