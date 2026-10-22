#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/9c839112c8e8ca2945725dafd012164801acb8965b8d61075bf16a3745635184/contract";
import startContract from "../../snapshots/9c839112c8e8ca2945725dafd012164801acb8965b8d61075bf16a3745635184/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/d74c24e8bc8310ff5c3b4bc9bf8193a4c9bdced1fe3911ea6a5d0e26a161ca14/contract";
import endContract from "../../snapshots/d74c24e8bc8310ff5c3b4bc9bf8193a4c9bdced1fe3911ea6a5d0e26a161ca14/contract.json" with { type: "json" };

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
