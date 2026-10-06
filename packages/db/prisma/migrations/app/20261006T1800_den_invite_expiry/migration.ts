#!/usr/bin/env -S bun
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/7e46d468f5e402c512a5fd8fa07d45974d626d8255000e3325e385b60f529e92/contract";
import startContract from "../../snapshots/7e46d468f5e402c512a5fd8fa07d45974d626d8255000e3325e385b60f529e92/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/83d9b4276f7d4e776a7452e43cd56e373086672732722eff43b7ce1a3fdbd57b/contract";
import endContract from "../../snapshots/83d9b4276f7d4e776a7452e43cd56e373086672732722eff43b7ce1a3fdbd57b/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("inviteDurationDays", "int4", {
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("inviteExpiresAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
