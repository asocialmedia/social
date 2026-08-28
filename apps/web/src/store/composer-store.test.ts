import { beforeEach, describe, expect, test } from "bun:test";

import { useComposerStore } from "./composer-store";

describe("composer store openComposer mode semantics", () => {
  beforeEach(() => {
    useComposerStore.setState({ isOpen: false, mode: "post" });
  });

  test("bare open preserves the current mode", () => {
    useComposerStore.getState().setMode("gust");
    useComposerStore.getState().openComposer();
    expect(useComposerStore.getState().mode).toBe("gust");
    expect(useComposerStore.getState().isOpen).toBe(true);
  });

  test("bare open on a fresh session keeps the post default", () => {
    useComposerStore.getState().openComposer();
    expect(useComposerStore.getState().mode).toBe("post");
  });

  test("an explicit mode argument wins over the current mode", () => {
    useComposerStore.getState().setMode("gust");
    useComposerStore.getState().openComposer("post");
    expect(useComposerStore.getState().mode).toBe("post");
    useComposerStore.getState().openComposer("gust");
    expect(useComposerStore.getState().mode).toBe("gust");
  });
});
