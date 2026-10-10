import { describe, expect, test } from "bun:test";

import { renderToString } from "react-dom/server";

import type { PresenceUser } from "@/lib/messages/client";

import { OnlineFriendsStrip } from "./online-friends-strip";

function person(overrides: Partial<PresenceUser> = {}): PresenceUser {
  return {
    avatarUrl: null,
    displayName: "Ada",
    id: "ada",
    isFollowing: true,
    status: "online",
    username: "ada",
    ...overrides,
  };
}

function renderStrip(users: PresenceUser[], creating: string | null = null) {
  return renderToString(
    <OnlineFriendsStrip creating={creating} onSelect={() => {}} users={users} />
  );
}

describe("mobile online friends strip", () => {
  test("shows online followed people with circular avatars and online indicators", () => {
    const html = renderStrip([person()]);
    expect(html).toContain("Message Ada (@ada), online");
    expect(html).toContain("rounded-full!");
    expect(html).toContain("bg-green-500");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("md:hidden");
  });

  test("excludes idle people and people who only follow the viewer", () => {
    const html = renderStrip([
      person(),
      person({ displayName: "Idle", id: "idle", status: "idle" }),
      person({ displayName: "Follower", id: "follower", isFollowing: false }),
    ]);
    expect(html).toContain("Message Ada");
    expect(html).not.toContain("Message Idle");
    expect(html).not.toContain("Message Follower");
  });

  test("leaves no blank strip when nobody followed is online", () => {
    expect(renderStrip([])).toBe("");
    expect(renderStrip([person({ status: "idle" })])).toBe("");
  });

  test("prevents additional taps while a DM is opening", () => {
    const html = renderStrip([person(), person({ id: "bob" })], "ada");
    expect(html.match(/disabled=""/gu)).toHaveLength(2);
    expect(html.match(/aria-busy="true"/gu)).toHaveLength(1);
  });
});
