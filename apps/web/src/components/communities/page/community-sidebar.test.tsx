import { expect, mock, test } from "bun:test";

import type { CommunityData } from "@asm/db";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/components/layouts/navigation/search-field", () => ({
  default: () => null,
}));
mock.module("@/components/layouts/shell/sidebar-footer-links", () => ({
  default: () => null,
}));
mock.module("./community-about-card", () => ({
  default: () => <section>Community about</section>,
}));
mock.module("./community-people", () => ({
  CommunityPeople: () => <section>People and join requests</section>,
}));
mock.module("./community-top-members", () => ({
  CommunityTopMembers: () => null,
}));

const { default: CommunitySidebar } = await import("./community-sidebar");

function sidebar(type: CommunityData["type"]) {
  const community: CommunityData = {
    _count: { members: 1, posts: 1 },
    accentColor: "slate",
    avatarUrl: null,
    bannerUrl: null,
    createdAt: new Date("2026-10-23T00:00:00Z"),
    description: "Community description",
    id: "community",
    mature: false,
    name: "Community",
    ownerId: "owner",
    slug: "community",
    topics: [],
    type,
    updatedAt: new Date("2026-10-23T00:00:00Z"),
  };
  return renderToStaticMarkup(
    <CommunitySidebar
      community={community}
      membership={{ role: "OWNER", status: "ACTIVE" }}
      stats={{ communityAura: 0, members: 1, weeklyVisitors: 1 }}
    />
  );
}

test("private posts omit the about card while retaining people and request management", () => {
  const markup = sidebar("PRIVATE");
  expect(markup).not.toContain("Community about");
  expect(markup).toContain("People and join requests");
});

for (const type of ["PUBLIC", "RESTRICTED"] as const) {
  test(`${type.toLowerCase()} posts retain their about card`, () => {
    expect(sidebar(type)).toContain("Community about");
  });
}
