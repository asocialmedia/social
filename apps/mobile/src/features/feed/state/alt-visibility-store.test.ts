import { describe, expect, test } from "bun:test";

import { useAltVisibilityStore } from "./alt-visibility-store";

describe("alt-visibility-store", () => {
  test("toggle adds and removes one post without touching others", () => {
    useAltVisibilityStore.setState({ ids: new Set<string>() });
    const { toggle } = useAltVisibilityStore.getState();
    toggle("a");
    toggle("b");
    expect(useAltVisibilityStore.getState().ids.has("a")).toBe(true);
    expect(useAltVisibilityStore.getState().ids.has("b")).toBe(true);
    toggle("a");
    expect(useAltVisibilityStore.getState().ids.has("a")).toBe(false);
    expect(useAltVisibilityStore.getState().ids.has("b")).toBe(true);
  });

  test("ids identity changes on toggle so selectors re-evaluate", () => {
    useAltVisibilityStore.setState({ ids: new Set<string>() });
    const before = useAltVisibilityStore.getState().ids;
    useAltVisibilityStore.getState().toggle("a");
    expect(useAltVisibilityStore.getState().ids).not.toBe(before);
    expect(useAltVisibilityStore.getState().ids.has("a")).toBe(true);
  });

  test("the stored flag matches what rows will read", () => {
    useAltVisibilityStore.setState({ ids: new Set(["a"]) });
    expect(useAltVisibilityStore.getState().ids.has("a")).toBe(true);
    expect(useAltVisibilityStore.getState().ids.has("b")).toBe(false);
  });
});
