import type { ExploreResource } from "./explore-cache";

type ExploreStatus = "error" | "loading" | "success";

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
