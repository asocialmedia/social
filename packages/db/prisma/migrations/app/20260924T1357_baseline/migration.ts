#!/usr/bin/env -S node
import { Migration, MigrationCLI } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/02a928fd5ae3667e18aae17971a6d4552672bd7cc3c3141e2ea654c4f37506f1/contract";
import endContract from "../../snapshots/02a928fd5ae3667e18aae17971a6d4552672bd7cc3c3141e2ea654c4f37506f1/contract.json" with { type: "json" };

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
