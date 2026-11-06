#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/63d9a61e250e4f148de147056f1c225a606ecf5048a0dc687b48d5c9b32e2c7c/contract";
import endContract from "../../snapshots/63d9a61e250e4f148de147056f1c225a606ecf5048a0dc687b48d5c9b32e2c7c/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/aedbdea539513e8d042fe72a0f37440a619497552abc93da4781c64aed10b146/contract";
import startContract from "../../snapshots/aedbdea539513e8d042fe72a0f37440a619497552abc93da4781c64aed10b146/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: "public",
        typeName: "NotificationType",
        value: "COMMUNITY_JOIN_REQUEST",
      }),
      this.addNativeEnumValue({
        schema: "public",
        typeName: "NotificationType",
        value: "COMMUNITY_JOIN_APPROVED",
      }),
      this.addNativeEnumValue({
        schema: "public",
        typeName: "NotificationType",
        value: "COMMUNITY_JOIN_DECLINED",
      }),
      this.addColumn({
        schema: "public",
        table: "notifications",
        column: col("membershipRequestId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.createIndex({
        schema: "public",
        table: "community_members",
        index: "community_members_request_page_idx",
        columns: ["communityId", "status", "createdAt", "id"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
