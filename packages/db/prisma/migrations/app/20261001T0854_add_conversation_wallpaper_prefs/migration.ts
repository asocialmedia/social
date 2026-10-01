#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/b710be6a3e5e6e7f6accdce53c224fd887cd0be330a69146799ef246c4f79df9/contract";
import startContract from "../../snapshots/b710be6a3e5e6e7f6accdce53c224fd887cd0be330a69146799ef246c4f79df9/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/c2bdb01f005d03f6607e6443a95397d497e0ec084e656c779530059afc24dece/contract";
import endContract from "../../snapshots/c2bdb01f005d03f6607e6443a95397d497e0ec084e656c779530059afc24dece/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("wallpaperDim", "int4", {
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("wallpaperKey", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("wallpaperMediaId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addUnique({
        schema: "public",
        table: "message_conversation_members",
        constraint: "message_conversation_members_wallpaperMediaId_key",
        columns: ["wallpaperMediaId"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_conversation_members",
        foreignKey: {
          name: "message_conversation_members_wallpaperMediaId_fkey",
          columns: ["wallpaperMediaId"],
          references: {
            schema: "public",
            table: "post_media",
            columns: ["id"],
          },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
