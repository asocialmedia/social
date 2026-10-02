#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/20e4834e60e525681c5d493d17c83d2c6aeab54d2c2c9b4d48c3018634554e38/contract";
import endContract from "../../snapshots/20e4834e60e525681c5d493d17c83d2c6aeab54d2c2c9b4d48c3018634554e38/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/48160e35db232d4c1958ecd22d65e10856d39553bfe5afe05553d4336c403d54/contract";
import startContract from "../../snapshots/48160e35db232d4c1958ecd22d65e10856d39553bfe5afe05553d4336c403d54/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("leftAt", "timestamp(3)", {
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
