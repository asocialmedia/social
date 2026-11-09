import { beforeEach, describe, expect, test } from "bun:test";

import {
  FOLLOW_STATE_TTL_MS,
  resolveFollowing,
  useFollowStateStore,
} from "./follow-state-store";

describe("follow state store", () => {
  beforeEach(() => {
    useFollowStateStore.getState().clear();
  });

  test("a fresh shared answer wins over the post's snapshot", () => {
    useFollowStateStore.getState().setFollowing("u1", true, 1000);
    const entry = useFollowStateStore.getState().entries.u1;
    expect(resolveFollowing(entry, false, 1000 + FOLLOW_STATE_TTL_MS)).toBe(
      true
    );
  });

  test("a stale answer gives way to the snapshot again", () => {
    useFollowStateStore.getState().setFollowing("u1", true, 1000);
    const entry = useFollowStateStore.getState().entries.u1;
    expect(resolveFollowing(entry, false, 1000 + FOLLOW_STATE_TTL_MS + 1)).toBe(
      false
    );
  });

  test("no entry falls back to the snapshot", () => {
    expect(resolveFollowing(undefined, true)).toBe(true);
    expect(resolveFollowing(undefined, false)).toBe(false);
  });

  test("pending flags set and clear per author", () => {
    const store = useFollowStateStore.getState();
    store.setPending("u1", true);
    store.setPending("u2", true);
    useFollowStateStore.getState().setPending("u1", false);
    expect(useFollowStateStore.getState().pending).toEqual({ u2: true });
  });

  test("clear forgets every author, as sign-out needs", () => {
    const store = useFollowStateStore.getState();
    store.setFollowing("u1", true);
    store.setPending("u1", true);
    useFollowStateStore.getState().clear();
    expect(useFollowStateStore.getState().entries).toEqual({});
    expect(useFollowStateStore.getState().pending).toEqual({});
  });
});
