#!/usr/bin/env -S node
import { Migration, MigrationCLI } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/5250d26200dc4cdf6845809e9519810e8c329a6c3dc48725e0f1d897034551f0/contract";
import endContract from "../../snapshots/5250d26200dc4cdf6845809e9519810e8c329a6c3dc48725e0f1d897034551f0/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/c6d9eac560b0b36f4403509474767fd956b7d77d370f09b2c40ac0c6276f56d5/contract";
import startContract from "../../snapshots/c6d9eac560b0b36f4403509474767fd956b7d77d370f09b2c40ac0c6276f56d5/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.setDefault({
        schema: "public",
        table: "external_engagements",
        column: "amplifiedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.createIndex({
        schema: "public",
        table: "external_engagements",
        index: "external_engagement_amplification_time_idx",
        columns: ["userId", "amplified", "amplifiedAt", "externalPostId"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
