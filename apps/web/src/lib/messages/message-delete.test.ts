import { describe, expect, test } from "bun:test";

import { chunkMessageIds, messageDeleteCopy } from "./message-delete";

describe("messageDeleteCopy", () => {
  test("describes a single delete-for-me as actor-scoped", () => {
    const copy = messageDeleteCopy({ count: 1, scope: "for-me" });
    expect(copy.title).toBe("Delete for me?");
    expect(copy.confirmLabel).toBe("Delete for me");
    expect(copy.description).toContain("other person will still see it");
  });

  test("treats a zero count as the singular case", () => {
    expect(messageDeleteCopy({ count: 0, scope: "for-me" }).title).toBe(
      "Delete for me?"
    );
  });

  test("pluralizes a bulk delete-for-me with the count", () => {
    const copy = messageDeleteCopy({ count: 4, scope: "for-me" });
    expect(copy.title).toBe("Delete 4 messages for me?");
    expect(copy.description).toContain("other person will still see them");
  });

  test("warns that delete-for-everyone removes the peer's copy", () => {
    const copy = messageDeleteCopy({ count: 1, scope: "for-everyone" });
    expect(copy.title).toBe("Delete for everyone?");
    expect(copy.confirmLabel).toBe("Delete for everyone");
    expect(copy.description).toContain("removed for both of you");
    expect(copy.description).toContain("can't be undone");
  });
});

describe("chunkMessageIds", () => {
  test("returns no chunks for an empty list", () => {
    expect(chunkMessageIds([])).toEqual([]);
  });

  test("keeps a short list in one chunk", () => {
    expect(chunkMessageIds(["a", "b"], 3)).toEqual([["a", "b"]]);
  });

  test("splits at the boundary and preserves order", () => {
    const ids = Array.from({ length: 250 }, (_, index) => `m${index}`);
    const chunks = chunkMessageIds(ids);
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(ids);
  });

  test("rejects a non-positive chunk size", () => {
    expect(() => chunkMessageIds(["a"], 0)).toThrow();
  });
});
