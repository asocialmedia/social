import { expect, test } from "bun:test";

import { profileActivityOrder } from "./profile-activity-order";

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
