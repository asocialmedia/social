import { expect, mock, test } from "bun:test";

import type { UserData } from "@asm/db";
import type { ProfileUserListData } from "@asm/ui/lib/user-list";
import { renderToStaticMarkup } from "react-dom/server";

let activeTab = "following";
let pending = false;
const rows: ProfileUserListData[] = [
  {
    _count: { followers: 1 },
    avatarUrl: "/avatars/default-2.png",
    bio: null,
    displayName: "Alice",
    id: "alice",
    isFollowing: true,
    mutualCount: 1,
    mutualFollowers: [
      {
        avatarUrl: "/avatars/default-2.png",
        displayName: "Bob",
        id: "bob",
        username: "bob",
      },
    ],
    username: "alice",
  },
];
mock.module("next/navigation", () => ({
  usePathname: () => "/users/viewer/followers",
  useSearchParams: () => new URLSearchParams({ tab: activeTab }),
}));
mock.module("@tanstack/react-query", () => ({
  useQueries: () =>
    [0, 1].map(() => ({
      data: pending ? undefined : rows,
      isError: false,
      isPending: pending,
      refetch: () => {},
    })),
}));
mock.module("@/hooks/feed/use-feed-swipe-navigation", () => ({
  useFeedSwipeNavigation: () => {},
}));
mock.module("@/components/layouts/navigation/mobile/mobile-top-bar", () => ({
  default: () => null,
}));
mock.module("@/components/layouts/navigation/mobile/mobile-bottom-nav", () => ({
  default: () => null,
}));
mock.module("@/components/home/sidebars/right/trending-topics", () => ({
  default: () => <div>Trending topics</div>,
}));
mock.module("@/components/posts/views/post-history-card", () => ({
  default: () => <div>Recently viewed</div>,
}));
mock.module("@/components/layouts/feed/feed-scrollbar", () => ({
  FeedScrollbar: () => null,
}));
mock.module("@/components/layouts/user/follow-button", () => ({
  default: () => <button type="button">Following</button>,
}));
mock.module("@/components/protocols/external-follow-button", () => ({
  ExternalFollowButton: () => null,
}));
mock.module("@/components/profile/profile-list-avatar", () => ({
  ProfileListAvatar: () => <span data-profile-list-avatar />,
}));
const { default: FollowersFollowingPage } =
  await import("./followers-following-page");
const viewer = { id: "viewer", username: "viewer" } as UserData;

function render() {
  return renderToStaticMarkup(
    <FollowersFollowingPage userData={viewer} loggedInUserData={viewer} />
  );
}

test("the following sidebar hides only its scrollbar and mutual avatars keep the app's squircle shape", () => {
  pending = false;
  const html = render();
  const aside = html.match(/<aside[^>]+>/)?.[0] ?? "";
  expect(aside).toContain("hide-native-scrollbar");
  expect(aside).toContain("overflow-y-auto");
  expect(html).toContain("data-profile-list-avatar");
  expect(html).toContain("1 mutual");
  expect(html).not.toContain("rounded-full!");
  expect(html).toContain('width="18"');
});

test.each(["followers", "following"])(
  "%s loading shows people rows instead of post cards",
  (tab) => {
    activeTab = tab;
    pending = true;
    const html = render();
    expect(html).toContain("Loading people");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Loading feed");
    expect(html).not.toContain("1 mutual");
  }
);
