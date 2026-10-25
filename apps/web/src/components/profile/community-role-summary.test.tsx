import { expect, mock, test } from "bun:test";

import type { UserCommunityRole } from "@asm/db";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/components/communities/card/community-avatar", () => ({
  default: ({ name }: { name: string }) => (
    <span aria-label={name} data-community-avatar />
  ),
}));
mock.module("@/components/communities/card/community-role-badge", () => ({
  default: () => <span data-role-badge>Duplicate badge</span>,
}));
const { default: CommunityRoleSummary } =
  await import("./community-role-summary");
const community = {
  accentColor: "#ff9500",
  avatarUrl: null,
  id: "anime",
  name: "Anime",
  slug: "anime",
};

test.each([
  ["OWNER", "Owner of"],
  ["MODERATOR", "Moderator of"],
  ["MEMBER", "Member of"],
] as const)(
  "%s shows the role sentence, avatar, and community link without a badge",
  (role, label) => {
    const html = renderToStaticMarkup(
      <CommunityRoleSummary roles={[{ community, role }]} />
    );
    expect(html).toContain(label);
    expect(html).toContain('href="/a/anime"');
    expect(html).toContain("data-community-avatar");
    expect(html).toContain("a/anime");
    expect(html).not.toContain("data-role-badge");
  }
);

test("multiple communities retain role order and the collapsed count", () => {
  const roles: UserCommunityRole[] = [
    { community, role: "MEMBER" },
    ...["art", "cosplay", "games"].map((slug) => ({
      community: { ...community, id: slug, slug },
      role: "OWNER" as const,
    })),
  ];
  const html = renderToStaticMarkup(<CommunityRoleSummary roles={roles} />);
  expect(html.indexOf("Owner of")).toBeLessThan(html.indexOf("Member of"));
  expect(html).toContain("a/art");
  expect(html).toContain("a/cosplay");
  expect(html).toContain("1 more");
  expect(html).not.toContain("a/games");
});
