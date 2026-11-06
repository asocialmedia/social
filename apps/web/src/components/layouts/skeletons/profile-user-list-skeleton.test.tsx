import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  FollowersPageSkeleton,
  ProfileUserListSkeleton,
} from "./profile-user-list-skeleton";

test("people list placeholders match avatar and button sizes without post cards", () => {
  const html = renderToStaticMarkup(<ProfileUserListSkeleton />);
  expect(html).toContain('aria-busy="true"');
  expect(html.match(/size-11 shrink-0/g)).toHaveLength(7);
  expect(html.match(/h-8 w-20/g)).toHaveLength(7);
  expect(html).toContain("rounded-[30%]");
  expect(html).not.toContain("Loading feed");
});

test("followers route loading keeps the people layout, tabs, search and right column", () => {
  const html = renderToStaticMarkup(<FollowersPageSkeleton />);
  expect(html).toContain("Loading followers and following");
  expect(html).toContain("Loading people");
  expect(html).toContain("h-9 w-full");
  expect(html).toContain("lg:max-w-5xl");
  expect(html).toContain("w-80");
  expect(html).not.toContain("Loading feed");
});
