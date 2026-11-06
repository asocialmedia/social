import { describe, expect, test } from "bun:test";

import {
  clearGlobalMessageSearchViewState,
  peekGlobalMessageSearchViewState,
  saveGlobalMessageSearchViewState,
  takeGlobalMessageSearchViewState,
} from "./global-message-search-view-state";

describe("global message search view state", () => {
  test("retains the filter and profile expansion across repeated render initialization", () => {
    const state = {
      conversationType: "DEN" as const,
      profilesExpanded: true,
      query: "needle",
      scrollTop: 256,
      selectedMessageId: "message-2",
    };
    saveGlobalMessageSearchViewState("strict-render-user", state);
    expect(peekGlobalMessageSearchViewState("strict-render-user")).toEqual(
      state
    );
    expect(peekGlobalMessageSearchViewState("strict-render-user")).toEqual(
      state
    );
    clearGlobalMessageSearchViewState("strict-render-user");
    expect(peekGlobalMessageSearchViewState("strict-render-user")).toBeNull();
  });
  test("restores a selected result once for the same user", () => {
    const state = {
      query: "veldrith thread",
      scrollTop: 384,
      selectedMessageId: "message-1",
    };

    saveGlobalMessageSearchViewState("user-1", state);

    expect(takeGlobalMessageSearchViewState("user-2")).toBeNull();
    expect(takeGlobalMessageSearchViewState("user-1")).toEqual(state);
    expect(takeGlobalMessageSearchViewState("user-1")).toBeNull();
  });

  test("replaces and clears a pending restoration", () => {
    saveGlobalMessageSearchViewState("user-1", {
      query: "old query",
      scrollTop: 20,
      selectedMessageId: "message-1",
    });
    saveGlobalMessageSearchViewState("user-1", {
      query: "new query",
      scrollTop: 40,
      selectedMessageId: "message-2",
    });

    clearGlobalMessageSearchViewState("user-1");

    expect(takeGlobalMessageSearchViewState("user-1")).toBeNull();
  });
});
