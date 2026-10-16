import { afterEach, expect, test } from "bun:test";

import { useSharedPostDraft } from "./shared-post-draft";

afterEach(() => {
  useSharedPostDraft.setState({ drafts: {} });
});

test("a post attaches only to the chosen conversation and clearing leaves other drafts intact", () => {
  useSharedPostDraft.getState().attach("first", "post-1");
  useSharedPostDraft.getState().attach("second", "post-2");
  useSharedPostDraft.getState().attach("first", "post-3");
  expect(useSharedPostDraft.getState().drafts).toEqual({
    first: "post-3",
    second: "post-2",
  });
  useSharedPostDraft.getState().clear("first");
  expect(useSharedPostDraft.getState().drafts).toEqual({ second: "post-2" });
});
