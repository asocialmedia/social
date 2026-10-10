import { describe, expect, test } from "bun:test";

import { resolvePostMediaIndex } from "./post-path";

describe("cached and refreshed fullscreen attachment selection", () => {
  const attachments = [{ id: "image" }, { id: "video" }];
  test("profile media IDs take precedence over a route index", () => {
    expect(resolvePostMediaIndex(attachments, 0, "video")).toBe(1);
  });
  test("deleted or missing media IDs fall back to a bounded route index", () => {
    expect(resolvePostMediaIndex(attachments, 9, "deleted")).toBe(1);
    expect(resolvePostMediaIndex(attachments, -1)).toBe(0);
    expect(resolvePostMediaIndex(attachments, 0)).toBe(0);
  });
  test("an empty or missing attachment list never enters a ready viewer", () => {
    expect(resolvePostMediaIndex([], 0)).toBeNull();
    expect(resolvePostMediaIndex(undefined, 0)).toBeNull();
  });
});
