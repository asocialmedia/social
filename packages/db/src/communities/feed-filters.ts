export const COMMUNITY_POST_TYPES = [
  { label: "Everything", value: "all" },
  { label: "Text", value: "text" },
  { label: "Images", value: "images" },
  { label: "Videos", value: "videos" },
  { label: "Audio", value: "audio" },
  { label: "Links", value: "links" },
] as const;

export const COMMUNITY_POST_RANGES = [
  { label: "Any time", value: "all" },
  { label: "Past day", value: "day" },
  { label: "Past week", value: "week" },
  { label: "Past month", value: "month" },
  { label: "Past year", value: "year" },
] as const;

export const COMMUNITY_POST_RATINGS = [
  { label: "All ratings", value: "all" },
  { label: "Non-explicit", value: "safe" },
  { label: "Explicit", value: "explicit" },
] as const;

export interface CommunityPostFilters {
  type: (typeof COMMUNITY_POST_TYPES)[number]["value"];
  range: (typeof COMMUNITY_POST_RANGES)[number]["value"];
  rating: (typeof COMMUNITY_POST_RATINGS)[number]["value"];
  query: string;
  author: string;
}

export interface CommunityFeedSelection extends CommunityPostFilters {
  sort: "new" | "top";
}

export function readCommunityFeedSelection(
  params: Pick<URLSearchParams, "get">
): CommunityFeedSelection {
  return {
    author: (params.get("author") ?? "").trim().replace(/^@/u, "").slice(0, 64),
    query: (params.get("q") ?? "").trim().slice(0, 120),
    range:
      COMMUNITY_POST_RANGES.find((item) => item.value === params.get("range"))
        ?.value ?? "all",
    rating:
      COMMUNITY_POST_RATINGS.find((item) => item.value === params.get("rating"))
        ?.value ?? "all",
    sort: params.get("sort") === "top" ? "top" : "new",
    type:
      COMMUNITY_POST_TYPES.find((item) => item.value === params.get("type"))
        ?.value ?? "all",
  };
}

export function communityFeedSearchParams(
  selection: CommunityFeedSelection,
  current = ""
): URLSearchParams {
  const params = new URLSearchParams(current);
  for (const key of [
    "type",
    "range",
    "rating",
    "sort",
    "q",
    "author",
    "cursor",
  ]) {
    params.delete(key);
  }
  for (const key of ["type", "range", "rating"] as const) {
    if (selection[key] !== "all") {
      params.set(key, selection[key]);
    }
  }
  if (selection.sort !== "new") {
    params.set("sort", selection.sort);
  }
  if (selection.query) {
    params.set("q", selection.query);
  }
  if (selection.author) {
    params.set("author", selection.author);
  }
  return params;
}

export function communityFeedSince(
  range: CommunityPostFilters["range"],
  now = new Date()
): Date | null {
  const days = { all: 0, day: 1, month: 30, week: 7, year: 365 }[range];
  return days ? new Date(now.getTime() - days * 86_400_000) : null;
}

export function communityPostFilterCount(
  filters: CommunityPostFilters
): number {
  return (
    Number(filters.type !== "all") +
    Number(filters.range !== "all") +
    Number(filters.rating !== "all") +
    Number(Boolean(filters.query)) +
    Number(Boolean(filters.author))
  );
}
