import { afterEach, describe, expect, test } from "bun:test";

import { searchMessageUsers } from "./client";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function profile() {
  return {
    addRefusal: null,
    avatarUrl: null,
    badge: null,
    badges: [],
    displayName: "Ada",
    hasIdentity: true,
    id: "ada",
    username: "ada",
  };
}

function respond(users: unknown[]) {
  globalThis.fetch = Object.assign(
    () => Promise.resolve(Response.json({ users })),
    { preconnect: originalFetch.preconnect }
  );
}

describe("profile search response boundary", () => {
  test("accepts valid profile and den eligibility results", async () => {
    respond([
      profile(),
      { ...profile(), addRefusal: "NOT_FOLLOWING_YOU", id: "den-candidate" },
    ]);
    expect(await searchMessageUsers("ada", "den")).toHaveLength(2);
  });

  test("rejects malformed profile rows before the result list renders", async () => {
    respond([{ ...profile(), displayName: null }]);
    await expect(searchMessageUsers("ada")).rejects.toThrow(
      "Profile search results could not be loaded"
    );
  });

  test("rejects profile lists exceeding the bounded response contract", async () => {
    respond(Array.from({ length: 21 }, profile));
    await expect(searchMessageUsers("ada")).rejects.toThrow(
      "Profile search results could not be loaded"
    );
  });
});
