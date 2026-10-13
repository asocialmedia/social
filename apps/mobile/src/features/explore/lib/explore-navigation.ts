import type {
  ExploreDiscoveryTab,
  ExploreTab,
} from "@/features/feed/state/tab-store";

export function exploreFeedTabs(discovery: ExploreDiscoveryTab) {
  return [
    {
      label: discovery === "for-you" ? "For you" : "Trending",
      value: discovery,
    },
    { label: "Gusts", value: "gusts" },
    { label: "People", value: "people" },
  ] as const;
}

export function explorePageIndex(tab: ExploreTab): number {
  if (tab === "gusts") {
    return 1;
  }
  if (tab === "people") {
    return 2;
  }
  return 0;
}
