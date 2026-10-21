import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import { inventoryPost } from "./discovery-fixtures";
import { DiscoveryInventory } from "./discovery-inventory";
import { MemoryDiscoveryStore } from "./discovery-store";

test("verified sparse arrivals return before an unresolved source refill and keep their continuation", async () => {
  const posts = Array.from({ length: 23 }, (_, index) =>
    inventoryPost(index, "TypeScript")
  );
  const pending = Promise.withResolvers<{
    cursor: null;
    items: ExternalPost[];
    partial: false;
  }>();
  const inventory = new DiscoveryInventory(
    {
      invalidate: () => Promise.resolve(),
      put: () => Promise.resolve(),
      read: () => Promise.resolve(posts),
    },
    new MemoryDiscoveryStore(),
    () => pending.promise
  );
  const head = await inventory.read(
    "personalized",
    undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  const page = await Promise.race([
    inventory.read(
      "personalized",
      head?.cursor ?? undefined,
      "en",
      ["TypeScript"],
      "all"
    ),
    (async () => {
      await Bun.sleep(100);
      return "blocked" as const;
    })(),
  ]);
  expect(page).not.toBe("blocked");
  if (page && page !== "blocked") {
    expect(page.items).toHaveLength(3);
    expect(page.partial).toBe(true);
    expect(page.cursor).not.toBeNull();
    expect(
      page.items.some((post) => head?.items.some((old) => old.id === post.id))
    ).toBe(false);
  }
  pending.resolve({ cursor: null, items: [], partial: false });
});
