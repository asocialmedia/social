#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/138af29975c9707748b1aaa401859a1a8c3fd7bfb5ce447ff70199f1193156c0/contract";
import endContract from "../../snapshots/138af29975c9707748b1aaa401859a1a8c3fd7bfb5ce447ff70199f1193156c0/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/c6cb9700c6878c1f89bfbce3790399eb6c364feabb05d62f4096d6a555823876/contract";
import startContract from "../../snapshots/c6cb9700c6878c1f89bfbce3790399eb6c364feabb05d62f4096d6a555823876/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): Migration<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "recommendation_events",
        column: col("rankingContext", "json", {
          codecRef: { codecId: "pg/json@1" },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
