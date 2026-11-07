import type { ExploreResource } from "./explore-cache";

export type ExploreStatus = "error" | "loading" | "success";

export function exploreDisplayStatus(
  hasContent: boolean,
  asm: Pick<ExploreResource, "data" | "error">,
  bluesky?: ExploreStatus
): ExploreStatus {
  if (hasContent) {
    return "success";
  }
  if ((!asm.data && !asm.error) || bluesky === "loading") {
    return "loading";
  }
  return asm.error || bluesky === "error" ? "error" : "success";
}

// Web's People discovery has no explore-cache page: its status is the
// suggestions status. Content wins, then a bare load, then an error with
// nothing to show, else the empty state.
export function peopleDiscoveryStatus(
  hasAccounts: boolean,
  loading: boolean,
  error: string | null
): ExploreStatus {
  if (hasAccounts) {
    return "success";
  }
  if (loading) {
    return "loading";
  }
  return error ? "error" : "success";
}
