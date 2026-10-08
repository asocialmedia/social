#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/7a502bc4412f0e7c01b3d285e677c4a8b10a96a3e30b1e511292ef236a63e0d5/contract";
import endContract from "../../snapshots/7a502bc4412f0e7c01b3d285e677c4a8b10a96a3e30b1e511292ef236a63e0d5/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/be310df7fdd814138a2372ff4b36eef8fb63bb78d55fbdc79ac82d404e6546b2/contract";
import startContract from "../../snapshots/be310df7fdd814138a2372ff4b36eef8fb63bb78d55fbdc79ac82d404e6546b2/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("unreadCount", "int4", {
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_members",
        index: "message_conversation_members_unread_count_idx",
        columns: ["unreadCount"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
