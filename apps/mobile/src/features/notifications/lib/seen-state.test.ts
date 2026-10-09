import { expect, test } from "bun:test";

import { markNotificationRowsSeen } from "./seen-state";

test("acknowledged read clears existing indicators without hiding a later arrival", () => {
  const earlier = {
    createdAt: "2026-10-09T12:00:00Z",
    id: "earlier",
    read: false,
  };
  const later = { createdAt: "2026-10-09T12:00:02Z", id: "later", read: false };
  const read = {
    createdAt: new Date("2026-10-09T11:00:00Z"),
    id: "read",
    read: true,
  };
  const rows = markNotificationRowsSeen(
    [earlier, later, read],
    Date.parse("2026-10-09T12:00:01Z")
  );
  expect(rows[0]?.read).toBe(true);
  expect(rows[1]).toBe(later);
  expect(rows[2]).toBe(read);
  expect(markNotificationRowsSeen([earlier], 0)[0]).toBe(earlier);
});
