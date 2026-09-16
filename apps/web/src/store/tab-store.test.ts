import { beforeEach, describe, expect, test } from "bun:test";

import {
  resolveExploreTab,
  resolveHomeTab,
  resolveProfileTab,
  TAB_MEMORY_TTL_MS,
  useTabStore,
} from "./tab-store";

const FRESH = Date.now();
const EXPIRED = Date.now() - TAB_MEMORY_TTL_MS - 1000;

beforeEach(() => {
  useTabStore.getState().resetTabMemory();
});

describe("home tab resolution", () => {
  test("explicit ?tab= beats remembered state", () => {
    expect(
      resolveHomeTab(
        "trending",
        true,
        { updatedAt: FRESH, value: "latest" },
        true
      )
    ).toBe("trending");
  });

  test("remembered tab wins over the default once hydrated", () => {
    expect(
      resolveHomeTab(null, true, { updatedAt: FRESH, value: "latest" }, true)
    ).toBe("latest");
  });

  test("pre-hydration render uses the default (no SSR mismatch)", () => {
    expect(
      resolveHomeTab(null, true, { updatedAt: FRESH, value: "latest" }, false)
    ).toBe("personalized");
    expect(
      resolveHomeTab(
        null,
        false,
        { updatedAt: FRESH, value: "following" },
        false
      )
    ).toBe("latest");
  });

  test("expired memory falls back to the default", () => {
    expect(
      resolveHomeTab(null, true, { updatedAt: EXPIRED, value: "latest" }, true)
    ).toBe("personalized");
  });

  test("invalid ?tab= falls back to memory, then default", () => {
    expect(
      resolveHomeTab(
        "nope",
        true,
        { updatedAt: FRESH, value: "trending" },
        true
      )
    ).toBe("trending");
    expect(resolveHomeTab("nope", false, null, true)).toBe("latest");
  });
});

describe("explore tab resolution", () => {
  test("explicit ?tab= wins, even for-you as guest", () => {
    expect(resolveExploreTab("for-you", false, null, true)).toBe("for-you");
  });

  test("guests keep remembered open tabs but not gated ones", () => {
    expect(
      resolveExploreTab(null, false, { updatedAt: FRESH, value: "gusts" }, true)
    ).toBe("gusts");
    expect(
      resolveExploreTab(
        null,
        false,
        { updatedAt: FRESH, value: "for-you" },
        true
      )
    ).toBe("trending");
    expect(
      resolveExploreTab(
        null,
        false,
        { updatedAt: FRESH, value: "people" },
        true
      )
    ).toBe("trending");
  });

  test("logged-in users restore any remembered tab", () => {
    expect(
      resolveExploreTab(null, true, { updatedAt: FRESH, value: "people" }, true)
    ).toBe("people");
  });

  test("expired memory falls back to the default", () => {
    expect(
      resolveExploreTab(
        null,
        true,
        { updatedAt: EXPIRED, value: "gusts" },
        true
      )
    ).toBe("for-you");
  });
});

describe("profile tab resolution (per profile)", () => {
  test("no memory means posts", () => {
    expect(resolveProfileTab(null, true, false, true)).toBe("posts");
    expect(resolveProfileTab(undefined, false, false, false)).toBe("posts");
  });

  test("remembered tab restores below xl", () => {
    expect(
      resolveProfileTab(
        { updatedAt: FRESH, value: "responses" },
        true,
        false,
        true
      )
    ).toBe("responses");
    expect(
      resolveProfileTab({ updatedAt: FRESH, value: "media" }, true, false, true)
    ).toBe("media");
  });

  test("guests fall back to posts for gated tabs", () => {
    expect(
      resolveProfileTab(
        { updatedAt: FRESH, value: "responses" },
        false,
        false,
        true
      )
    ).toBe("posts");
    expect(
      resolveProfileTab(
        { updatedAt: FRESH, value: "gusts" },
        false,
        false,
        true
      )
    ).toBe("gusts");
  });

  test("xl layout resolves remembered media back to posts", () => {
    expect(
      resolveProfileTab({ updatedAt: FRESH, value: "media" }, true, true, true)
    ).toBe("posts");
  });

  test("expired memory falls back to posts", () => {
    expect(
      resolveProfileTab(
        { updatedAt: EXPIRED, value: "gusts" },
        true,
        false,
        true
      )
    ).toBe("posts");
  });
});

describe("tab store actions", () => {
  test("home and explore setters refresh the stored tab", () => {
    useTabStore.getState().setHomeTab("latest");
    useTabStore.getState().setExploreTab("gusts");
    const { explore, home } = useTabStore.getState();
    expect(home?.value).toBe("latest");
    expect(explore?.value).toBe("gusts");
  });

  test("profile tabs are keyed per user id", () => {
    useTabStore.getState().setProfileTab("lisa-id", "media");
    useTabStore.getState().setProfileTab("harsh-id", "gusts");
    const { profileByUserId } = useTabStore.getState();
    expect(profileByUserId["lisa-id"]?.value).toBe("media");
    expect(profileByUserId["harsh-id"]?.value).toBe("gusts");

    // Updating one profile leaves the other untouched.
    useTabStore.getState().setProfileTab("lisa-id", "responses");
    expect(useTabStore.getState().profileByUserId["lisa-id"]?.value).toBe(
      "responses"
    );
    expect(useTabStore.getState().profileByUserId["harsh-id"]?.value).toBe(
      "gusts"
    );
  });

  test("pruneExpired drops stale entries and keeps fresh ones", () => {
    useTabStore.setState({
      explore: { updatedAt: EXPIRED, value: "gusts" },
      home: { updatedAt: FRESH, value: "latest" },
      profileByUserId: {
        "fresh-id": { updatedAt: FRESH, value: "gusts" },
        "stale-id": { updatedAt: EXPIRED, value: "media" },
      },
    });
    useTabStore.getState().pruneExpired();
    const state = useTabStore.getState();
    expect(state.home?.value).toBe("latest");
    expect(state.explore).toBeNull();
    expect(state.profileByUserId["fresh-id"]?.value).toBe("gusts");
    expect(state.profileByUserId["stale-id"]).toBeUndefined();
  });
});
