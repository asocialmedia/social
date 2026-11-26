import { expect, mock, test } from "bun:test";

import type { CommunityData } from "@asm/db";
import { renderToStaticMarkup } from "react-dom/server";

let user: { id: string } | null = null;
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user }),
}));
mock.module("./join-button", () => ({
  default: () => <button type="button">Join</button>,
}));
mock.module("./notify-button", () => ({
  default: () => <button type="button">Community notifications</button>,
}));
mock.module("./community-join-requests", () => ({
  default: () => null,
}));

const { default: CommunityHeader } = await import("./community-header");

const community: CommunityData = {
  _count: { members: 1, posts: 0 },
  accentColor: "forest",
  avatarUrl: null,
  bannerUrl: null,
  createdAt: new Date("2026-11-26T00:00:00Z"),
  description: "A community for discussion",
  id: "table",
  mature: false,
  name: "The Open Table",
  ownerId: "owner",
  slug: "table",
  topics: [],
  type: "PUBLIC",
  updatedAt: new Date("2026-11-26T00:00:00Z"),
};

test("keeps the community header visible to guests and shows membership controls after sign-in", () => {
  const header = (
    <CommunityHeader
      community={community}
      membership={null}
      members={1}
      subscribed={false}
    />
  );
  const guest = renderToStaticMarkup(header);
  expect(guest).toContain("The Open Table");
  expect(guest).not.toContain(">Join</button>");
  expect(guest).not.toContain("Community notifications");

  user = { id: "viewer" };
  try {
    const signedIn = renderToStaticMarkup(header);
    expect(signedIn).toContain(">Join</button>");
    expect(signedIn).toContain("Community notifications");
  } finally {
    user = null;
  }
});
