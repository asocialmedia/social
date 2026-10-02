#!/usr/bin/env -S node
import { Migration, MigrationCLI } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/c2e04192b3a88b216d810715c83bac4591323697224e45771671dfd9ba9c2dc4/contract";
import endContract from "../../snapshots/c2e04192b3a88b216d810715c83bac4591323697224e45771671dfd9ba9c2dc4/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/f94282735d49034e33c23f57f7c87df470a6d116581c241e0364d485ea7e0a59/contract";
import startContract from "../../snapshots/f94282735d49034e33c23f57f7c87df470a6d116581c241e0364d485ea7e0a59/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addNativeEnumValue({
        schema: "public",
        typeName: "NotificationType",
        value: "DEN_MEMBERSHIP_ENDED",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
