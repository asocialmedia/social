#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/bead356b8ab9022bad6b8a21230c3891edf0eec9601f9a399534036b34bb42d8/contract";
import startContract from "../../snapshots/bead356b8ab9022bad6b8a21230c3891edf0eec9601f9a399534036b34bb42d8/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/c6cb9700c6878c1f89bfbce3790399eb6c364feabb05d62f4096d6a555823876/contract";
import endContract from "../../snapshots/c6cb9700c6878c1f89bfbce3790399eb6c364feabb05d62f4096d6a555823876/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): Migration<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "posts",
        column: col("embeddingFingerprint", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "posts",
        column: col("embeddingModel", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
