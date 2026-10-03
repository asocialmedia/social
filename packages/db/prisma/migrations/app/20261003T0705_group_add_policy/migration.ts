#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  lit,
} from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/d3f6b4e9416bf62053040253609a08d81ca46d1279fc4806ffef1596371a057b/contract";
import startContract from "../../snapshots/d3f6b4e9416bf62053040253609a08d81ca46d1279fc4806ffef1596371a057b/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/e22b466270e899c6999ea16449cc712ce3492ae206ec04995ba701ebd62aa4f3/contract";
import endContract from "../../snapshots/e22b466270e899c6999ea16449cc712ce3492ae206ec04995ba701ebd62aa4f3/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.createNativeEnumType({
        schema: "public",
        typeName: "GroupAddPolicy",
        members: ["EVERYONE", "FOLLOWING_ONLY", "NO_DIRECT_ADDS"],
      }),
      this.addColumn({
        schema: "public",
        table: "users",
        column: col("groupAddPolicy", '"GroupAddPolicy"', {
          notNull: true,
          default: lit("FOLLOWING_ONLY"),
          codecRef: {
            codecId: "pg/enum@1",
            typeParams: { typeName: "GroupAddPolicy" },
          },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
