#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/7d283b55a58348a6e9bd0c560aaa228e7c672b2024a8a1046fabba45d82e13e6/contract";
import endContract from "../../snapshots/7d283b55a58348a6e9bd0c560aaa228e7c672b2024a8a1046fabba45d82e13e6/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/83d9b4276f7d4e776a7452e43cd56e373086672732722eff43b7ce1a3fdbd57b/contract";
import startContract from "../../snapshots/83d9b4276f7d4e776a7452e43cd56e373086672732722eff43b7ce1a3fdbd57b/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("inviteShortCode", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("inviteShortCodeDurationDays", "int4", {
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("inviteShortCodeExpiresAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addUnique({
        schema: "public",
        table: "message_conversations",
        constraint: "message_conversations_inviteShortCode_key",
        columns: ["inviteShortCode"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
