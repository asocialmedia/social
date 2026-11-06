#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  lit,
} from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/8944793ef419ba16745c891a31029b78710a5093029bb607912953e3c7fdb79a/contract";
import startContract from "../../snapshots/8944793ef419ba16745c891a31029b78710a5093029bb607912953e3c7fdb79a/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/b1af30e149c6818b87f997ed352168521625b3a5a35058c6873af99b9c36d300/contract";
import endContract from "../../snapshots/b1af30e149c6818b87f997ed352168521625b3a5a35058c6873af99b9c36d300/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: "public",
        table: "post_media",
        column: col("messageViewOnce", "bool", {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: "pg/bool@1" },
        }),
      }),
      this.createIndex({
        schema: "public",
        table: "message_media_links",
        index: "message_media_viewonce_media_unique_ff0d1126",
        columns: ["mediaId"],
        extras: { where: '("viewOnce")', unique: true },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
