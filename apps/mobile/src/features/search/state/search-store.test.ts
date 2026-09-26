import { describe, expect, test } from "bun:test";

import { useSearchStore } from "./search-store";

describe("useSearchStore", () => {
  test("initializes closed with empty query", () => {
    expect(useSearchStore.getState().isOpen).toBe(false);
    expect(useSearchStore.getState().initialQuery).toBe("");
  });

  test("opens with custom initial query", () => {
    useSearchStore.getState().open("rust");
    expect(useSearchStore.getState().isOpen).toBe(true);
    expect(useSearchStore.getState().initialQuery).toBe("rust");
  });

  test("closes and clears query", () => {
    useSearchStore.getState().close();
    expect(useSearchStore.getState().isOpen).toBe(false);
    expect(useSearchStore.getState().initialQuery).toBe("");
  });
});
