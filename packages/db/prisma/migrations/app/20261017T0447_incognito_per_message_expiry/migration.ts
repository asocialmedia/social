#!/usr/bin/env -S node
import { Migration, MigrationCLI } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/01e8edb08703574a24c039ef99376a0c2e3d13103202447b5fd0652af23820ef/contract";
import endContract from "../../snapshots/01e8edb08703574a24c039ef99376a0c2e3d13103202447b5fd0652af23820ef/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/cf8c639252b010d052d82c495160df6efc76d62a388603a549b0f3a1dff2d1cf/contract";
import startContract from "../../snapshots/cf8c639252b010d052d82c495160df6efc76d62a388603a549b0f3a1dff2d1cf/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropNotNull({
        schema: "public",
        table: "message_incognito_sessions",
        column: "expiresAt",
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_messages",
        index: "incognito_message_expiry_due_3855cff1",
        columns: ["createdAt", "id"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
