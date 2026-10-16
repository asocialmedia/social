import type { CommunityData, CommunityPage } from "./communities-api";

export const COMMUNITY_PAGE_GUTTER = 32;
export const COMMUNITY_SEARCH_ROW_INDEX = 1;
export type CommunityDiscoveryRow =
  | { key: "hero"; kind: "hero" }
  | { key: "search"; kind: "search" }
  | { key: "browse"; kind: "browse" }
  | { key: "state"; kind: "state" }
  | {
      key: "joined" | "trending" | "growing";
      kind: "rail";
      communities: CommunityData[];
      icon: "users" | "flame" | "zap";
      title: string;
    }
  | { key: string; kind: "community"; community: CommunityData };

export function communityDiscoveryRows({
  page,
  communities,
  showRails,
}: {
  page: CommunityPage | null;
  communities: CommunityData[];
  showRails: boolean;
}): CommunityDiscoveryRow[] {
  const rows: CommunityDiscoveryRow[] = [
    { key: "hero", kind: "hero" },
    { key: "search", kind: "search" },
  ];
  if (showRails && page) {
    const rails = [
      {
        communities: page.joined,
        icon: "users",
        key: "joined",
        title: "Joined communities",
      },
      {
        communities: page.sections.trending,
        icon: "flame",
        key: "trending",
        title: "Trending communities",
      },
      {
        communities: page.sections.growing,
        icon: "zap",
        key: "growing",
        title: "Growing fast",
      },
    ] as const;
    for (const rail of rails) {
      if (rail.communities.length) {
        rows.push({ ...rail, kind: "rail" });
      }
    }
  }
  rows.push({ key: "browse", kind: "browse" });
  if (communities.length) {
    rows.push(
      ...communities.map((community) => ({
        community,
        key: `community:${community.id}`,
        kind: "community" as const,
      }))
    );
  } else {
    rows.push({ key: "state", kind: "state" });
  }
  return rows;
}
