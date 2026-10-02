#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/5aabafb2d70124023d2d2effd48829782f30fe4063006e1977654a2e294166ef/contract";
import endContract from "../../snapshots/5aabafb2d70124023d2d2effd48829782f30fe4063006e1977654a2e294166ef/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/bf68714a648e4a747c8853324157fb0529bdff062c00ca60d65fdc82bc8f6273/contract";
import startContract from "../../snapshots/bf68714a648e4a747c8853324157fb0529bdff062c00ca60d65fdc82bc8f6273/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("invitedById", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_members",
        index: "message_conversation_members_invitedById_idx",
        columns: ["invitedById"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_conversation_members",
        foreignKey: {
          name: "message_conversation_members_invitedById_fkey",
          columns: ["invitedById"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
