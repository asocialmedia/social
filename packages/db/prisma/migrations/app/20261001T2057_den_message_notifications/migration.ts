#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/5aabafb2d70124023d2d2effd48829782f30fe4063006e1977654a2e294166ef/contract";
import startContract from "../../snapshots/5aabafb2d70124023d2d2effd48829782f30fe4063006e1977654a2e294166ef/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/f94282735d49034e33c23f57f7c87df470a6d116581c241e0364d485ea7e0a59/contract";
import endContract from "../../snapshots/f94282735d49034e33c23f57f7c87df470a6d116581c241e0364d485ea7e0a59/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addNativeEnumValue({
        schema: "public",
        typeName: "NotificationType",
        value: "DEN_MESSAGE",
      }),
      this.addColumn({
        schema: "public",
        table: "notifications",
        column: col("conversationId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.createIndex({
        schema: "public",
        table: "notifications",
        index: "notifications_recipientId_conversationId_type_read_idx",
        columns: ["recipientId", "conversationId", "type", "read"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "notifications",
        foreignKey: {
          name: "notifications_conversationId_fkey",
          columns: ["conversationId"],
          references: {
            schema: "public",
            table: "message_conversations",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
