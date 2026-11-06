import { expect, test } from "bun:test";

import {
  profileActivityOrder,
  advanceProfileActivity,
} from "./profile-activity-order";

test("activity pagination keeps each native or external record once and orders by the interaction time", () => {
  const rows = profileActivityOrder([
    { at: "2026-10-24T00:00:00Z", id: "same", type: "native" },
    { at: "2026-10-25T00:00:00Z", id: "same", type: "external" },
    { at: "2026-10-25T01:00:00Z", id: "same", type: "external" },
  ]);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    at: "2026-10-25T01:00:00Z",
    type: "external",
  });
  expect(rows[1]?.type).toBe("native");
});

const native = (id: string, at: string) => ({ at, id, type: "native" });

test("unread native pages hold older external activity below a shared frontier", () => {
  const external = {
    at: "2025-01-01T00:00:00Z",
    id: "external",
    type: "external",
  };
  const head = [
    native("new", "2026-02-01T00:00:00Z"),
    native("boundary", "2026-01-01T00:00:00Z"),
    external,
  ];
  const first = profileActivityOrder(head, [
    { boundary: "2026-01-01T00:00:00Z", hasNextPage: true },
    { hasNextPage: false },
  ]);
  expect(first.map((entry) => entry.id)).toEqual(["new"]);
  const next = profileActivityOrder(
    [...head, native("later", "2025-06-01T00:00:00Z")],
    [{ hasNextPage: false }, { hasNextPage: false }]
  );
  expect(next.slice(0, first.length)).toEqual(first);
  expect(next.map((entry) => entry.id)).toEqual([
    "new",
    "boundary",
    "later",
    "external",
  ]);
});

test("only the source at the frontier advances, including filtered empty pages", () => {
  expect(
    advanceProfileActivity([
      { boundary: "2026-01-01T00:00:00Z", hasNextPage: true },
      { boundary: "2025-01-01T00:00:00Z", hasNextPage: true },
    ])
  ).toEqual([true, false]);
  expect(
    advanceProfileActivity([{ hasNextPage: true }, { hasNextPage: false }])
  ).toEqual([true, false]);
});

test("initial source reads and equal timestamps cannot insert ahead of previously rendered activity", () => {
  const rows = [{ at: "2026-01-01T00:00:00Z", id: "a", type: "native" }];
  expect(
    profileActivityOrder(rows, [
      { hasNextPage: false },
      { hasNextPage: undefined, pending: true },
    ])
  ).toEqual([]);
  expect(
    advanceProfileActivity([
      { hasNextPage: true },
      { hasNextPage: undefined, pending: true },
    ])
  ).toEqual([false, false]);
  expect(
    profileActivityOrder(rows, [{ boundary: rows[0]?.at, hasNextPage: true }])
  ).toEqual([]);
  expect(profileActivityOrder(rows, [{ hasNextPage: false }])).toEqual(rows);
});
