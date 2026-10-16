import { expect, test } from "bun:test";

import type { CommunityData, CommunityPage } from "./communities-api";
import {
  COMMUNITY_SEARCH_ROW_INDEX,
  communityDiscoveryRows,
} from "./community-discovery";

const community: CommunityData = {
  _count: { members: 3, posts: 1 },
  accentColor: "ember",
  avatarUrl: null,
  bannerUrl: null,
  createdAt: "2026-09-22",
  description: "A space",
  id: "community",
  mature: false,
  name: "Community",
  ownerId: "owner",
  slug: "community",
  topics: ["art"],
  type: "PUBLIC",
  updatedAt: "2026-09-22",
};
const page: CommunityPage = {
  auras: {},
  communities: [community],
  counts: { all: 1 },
  joined: [community],
  nextCursor: null,
  sections: { growing: [community], trending: [] },
  stats: { communities: 1, members: 3, posts: 1 },
  total: 1,
};

test("the sticky row is search and the first All result remains a normal card", () => {
  const rows = communityDiscoveryRows({
    communities: page.communities,
    page,
    showRails: true,
  });
  expect(rows[COMMUNITY_SEARCH_ROW_INDEX]?.kind).toBe("search");
  expect(rows.map((row) => row.key)).toEqual([
    "hero",
    "search",
    "joined",
    "growing",
    "browse",
    "community:community",
  ]);
  expect(rows.at(-1)).toMatchObject({ community, kind: "community" });
});
test("filtering and empty results retain search without rendering discovery rails", () => {
  const rows = communityDiscoveryRows({
    communities: [],
    page,
    showRails: false,
  });
  expect(rows.map((row) => row.key)).toEqual([
    "hero",
    "search",
    "browse",
    "state",
  ]);
  expect(rows[COMMUNITY_SEARCH_ROW_INDEX]?.kind).toBe("search");
});
