#!/usr/bin/env -S node
import { Migration, MigrationCLI } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/76f73e9aed637b2c3cf996b7a2caeed3a12268b684129d0402575e2f1c753eba/contract";
import startContract from "../../snapshots/76f73e9aed637b2c3cf996b7a2caeed3a12268b684129d0402575e2f1c753eba/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/e1eff0c9dde5791726b035488e6edae24d971f7632ab8f5416069d414cbb5a23/contract";
import endContract from "../../snapshots/e1eff0c9dde5791726b035488e6edae24d971f7632ab8f5416069d414cbb5a23/contract.json" with { type: "json" };

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
