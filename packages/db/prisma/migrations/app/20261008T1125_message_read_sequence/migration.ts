#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/3dbc6de73b371fc0bc4da178d5c88889b2b9019bed61a493bb9b610000551e14/contract";
import startContract from "../../snapshots/3dbc6de73b371fc0bc4da178d5c88889b2b9019bed61a493bb9b610000551e14/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/150a9099f36a19ccce05220ad8498cbebc638383cea233f8395c4c67905f8d9a/contract";
import endContract from "../../snapshots/150a9099f36a19ccce05220ad8498cbebc638383cea233f8395c4c67905f8d9a/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("lastReadSequence", "int4", {
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
