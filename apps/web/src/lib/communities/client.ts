"use client";

import type {
  CommunityData,
  CommunityDiscoveryStats,
  CommunitySections,
  CommunityStats,
} from "@asm/db";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";

import kyInstance from "@/lib/ky";

export interface CommunitySidebarPayload {
  // The category with the most published posts, or null when nothing is posted.
  activeCategory: {
    count: number;
    key: string;
    label: string;
    topics: string[];
  } | null;
  // Global population ranking ("Popular communities"). Lives in the sidebar
  // payload rather than `sections` so searching the grid cannot blank it.
  popular: CommunityData[];
  // The viewer's own recent trail, newest first, with the visit time so the
  // row can show how long ago.
  recentVisits: { community: CommunityData; visitedAt: string }[];
  // Global ranking by community aura (sum of posts' aura).
  topByAura: CommunityData[];
}

export interface CommunityListResponse {
  // Community aura per community id (sum of its posts' raw aura).
  auras: Record<string, number>;
  communities: CommunityData[];
  // Public community counts per discovery category key, plus "all".
  counts: Record<string, number>;
  joined: CommunityData[];
  nextCursor: string | null;
  // Curated rails for the unfiltered view; empty when searching or paging.
  sections: CommunitySections;
  // Right-rail leaderboards.
  sidebar: CommunitySidebarPayload;
  // Headline totals for the discovery hero.
  stats: CommunityDiscoveryStats;
  // Total matching the active filter, ignoring the page size.
  total: number;
}

export interface CommunityDetailResponse {
  community: CommunityData;
  membership: {
    role: "MEMBER" | "MODERATOR" | "OWNER";
    status: "ACTIVE" | "PENDING";
  } | null;
  stats: CommunityStats;
}

export interface CommunityMemberRow {
  createdAt: string;
  role: "MEMBER" | "MODERATOR" | "OWNER";
  status: "ACTIVE" | "PENDING";
  user: {
    avatarUrl: string | null;
    displayName: string;
    id: string;
    username: string;
  };
}

export interface CommunityMembersResponse {
  canModerate: boolean;
  members: CommunityMemberRow[];
  membership: CommunityDetailResponse["membership"];
}

// Discovery browse with cursor pagination. The first page also carries the
// category counts, the curated sections and the filtered total. Previous
// results stay on screen while a new filter/search loads, so switching
// categories never blanks the page back to the skeleton.
export function useInfiniteCommunitiesQuery({
  category,
  q,
}: {
  category?: string;
  q?: string;
} = {}) {
  const search = q?.trim() ?? "";
  return useInfiniteQuery({
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      kyInstance
        .get("/api/communities", {
          searchParams: {
            ...(search ? { q: search } : {}),
            ...(category && category !== "all" ? { category } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        })
        .json<CommunityListResponse>(),
    queryKey: ["communities", category ?? "all", search],
    staleTime: 30_000,
  });
}

// The viewer's joined communities, used by the sidebar rail. Lightweight:
// the route skips the browse listing and counts for this call.
export function useJoinedCommunitiesQuery(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: () =>
      kyInstance
        .get("/api/communities", { searchParams: { joined: "1" } })
        .json<CommunityListResponse>(),
    queryKey: ["community-joined"],
    staleTime: 60_000,
  });
}

export function useCommunityQuery(slug: string) {
  return useQuery({
    enabled: Boolean(slug),
    queryFn: () =>
      kyInstance
        .get(`/api/communities/${slug}`)
        .json<CommunityDetailResponse>(),
    queryKey: ["community", slug],
    staleTime: 30_000,
  });
}

export function useCommunityMembersQuery(slug: string, pending = false) {
  return useQuery({
    enabled: Boolean(slug),
    queryFn: () =>
      kyInstance
        .get(`/api/communities/${slug}/members`, {
          searchParams: pending ? { pending: "1" } : {},
        })
        .json<CommunityMembersResponse>(),
    queryKey: ["community-members", slug, pending ? "pending" : "active"],
  });
}
