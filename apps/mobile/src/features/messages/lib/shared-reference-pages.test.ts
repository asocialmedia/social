import { expect, test } from "bun:test";

import { mergeSharedReferencePages } from "./shared-reference-pages";

test("older shared-content pages preserve newer items and deduplicate boundaries", () => {
  const head = { key: "new:0", label: "new" };
  const older = { key: "old:0", label: "old" };
  expect(
    mergeSharedReferencePages([{ rows: [head] }, { rows: [head, older] }])
  ).toEqual([head, older]);
});
test("revalidated pages replace edited rows and remove deleted references", () => {
  const pages = new Map([
    [
      "head",
      {
        rows: [
          { key: "deleted:0", label: "removed" },
          { key: "edit:0", label: "before" },
        ],
      },
    ],
    ["tail", { rows: [{ key: "old:0", label: "older" }] }],
  ]);
  expect(mergeSharedReferencePages(pages.values())).toHaveLength(3);
  pages.set("head", { rows: [{ key: "edit:0", label: "after" }] });
  expect(mergeSharedReferencePages(pages.values())).toEqual([
    { key: "edit:0", label: "after" },
    { key: "old:0", label: "older" },
  ]);
});
