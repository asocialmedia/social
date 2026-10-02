#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  Migration as MigrationType,
  col,
  primaryKey,
} from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/48160e35db232d4c1958ecd22d65e10856d39553bfe5afe05553d4336c403d54/contract";
import endContract from "../../snapshots/48160e35db232d4c1958ecd22d65e10856d39553bfe5afe05553d4336c403d54/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/e0db41f797b37e7ade1a45f9deae388795d20087c07f19a72dc45dd334e5c5a1/contract";
import startContract from "../../snapshots/e0db41f797b37e7ade1a45f9deae388795d20087c07f19a72dc45dd334e5c5a1/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.createTable({
        schema: "public",
        table: "message_conversation_invite_codes",
        columns: [
          col("code", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("retiredAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
        ],
        constraints: [
          primaryKey(["code"], {
            name: "message_conversation_invite_codes_pkey",
          }),
        ],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_invite_codes",
        index: "message_conversation_invite_codes_conversationId_retiredAt_idx",
        columns: ["conversationId", "retiredAt"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_conversation_invite_codes",
        foreignKey: {
          name: "message_conversation_invite_codes_conversationId_fkey",
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
