#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  fn,
} from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/d1e4b3353eba935e395ef107d463a1f8a0924657f3e1f7ef98743232e8f0c158/contract";
import endContract from "../../snapshots/d1e4b3353eba935e395ef107d463a1f8a0924657f3e1f7ef98743232e8f0c158/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/da193d30e4b244befee8f188be74d8b355350db2e201bdee5f340df943bec4f0/contract";
import startContract from "../../snapshots/da193d30e4b244befee8f188be74d8b355350db2e201bdee5f340df943bec4f0/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.setDefault({
        schema: "public",
        table: "external_engagements",
        column: col("amplifiedAt", "timestamp(3)", {
          default: fn("now()"),
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.createIndex({
        schema: "public",
        table: "external_engagements",
        index: "external_engagement_amplification_time_idx",
        columns: ["userId", "amplified", "amplifiedAt", "externalPostId"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
