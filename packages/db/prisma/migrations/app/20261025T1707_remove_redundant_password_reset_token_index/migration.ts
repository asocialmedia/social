#!/usr/bin/env -S node
import { Migration, MigrationCLI } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/4e911d901613b85b603ffa5e1a67bb1186f3f59e04a7cd4adf3c2702e94b36ad/contract";
import endContract from "../../snapshots/4e911d901613b85b603ffa5e1a67bb1186f3f59e04a7cd4adf3c2702e94b36ad/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/d1e4b3353eba935e395ef107d463a1f8a0924657f3e1f7ef98743232e8f0c158/contract";
import startContract from "../../snapshots/d1e4b3353eba935e395ef107d463a1f8a0924657f3e1f7ef98743232e8f0c158/contract.json" with { type: "json" };

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
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
