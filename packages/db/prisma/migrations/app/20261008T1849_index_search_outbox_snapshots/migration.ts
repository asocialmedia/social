#!/usr/bin/env -S node
import { Migration, MigrationCLI } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/34b4c4296280a1c84cea452c616e7f02415c28901e44d0e8141fd1c97aec68c9/contract";
import startContract from "../../snapshots/34b4c4296280a1c84cea452c616e7f02415c28901e44d0e8141fd1c97aec68c9/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/ebf1490d0c8bf1fbe92fcd3d6d5947afff5ae483f2a9db3bcae88724c77724a0/contract";
import endContract from "../../snapshots/ebf1490d0c8bf1fbe92fcd3d6d5947afff5ae483f2a9db3bcae88724c77724a0/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.createIndex({
        schema: "public",
        table: "message_search_outbox",
        index: "message_search_outbox_message_sequence_idx",
        columns: ["messageId", "changeSequence"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
