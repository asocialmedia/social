#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  fn,
} from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/acb4b618e109a205ce67ceb4443db6be7100eb14433fc1709edfba09569e3224/contract";
import startContract from "../../snapshots/acb4b618e109a205ce67ceb4443db6be7100eb14433fc1709edfba09569e3224/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/c1c1c867d8629d37906397f1f1ceaab3dfaffd156be0ed25955d90484a84ccb1/contract";
import endContract from "../../snapshots/c1c1c867d8629d37906397f1f1ceaab3dfaffd156be0ed25955d90484a84ccb1/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropIndex({
        schema: "public",
        table: "password_reset_tokens",
        index: "password_reset_tokens_token_idx",
      }),
      this.addColumn({
        schema: "public",
        table: "external_engagements",
        column: col("amplifiedAt", "timestamp(3)", {
          notNull: true,
          default: fn("now()"),
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
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
