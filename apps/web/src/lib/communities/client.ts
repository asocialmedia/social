"use client";

import type { CommunityData, CommunityStats } from "@asm/db";
import { useQuery } from "@tanstack/react-query";

import kyInstance from "@/lib/ky";

export interface CommunityListResponse {
  communities: CommunityData[];
  joined: CommunityData[];
  nextCursor: string | null;
  stats: Record<string, CommunityStats>;
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

// Discovery listing + search. The query key includes the topic and search term
// so each rail/filter caches independently.
export function useCommunitiesQuery({
  enabled = true,
  q,
  topic,
}: {
  enabled?: boolean;
  q?: string;
  topic?: string;
} = {}) {
  return useQuery({
    enabled,
    queryFn: () =>
      kyInstance
        .get("/api/communities", {
          searchParams: {
            ...(q ? { q } : {}),
            ...(topic ? { topic } : {}),
          },
        })
        .json<CommunityListResponse>(),
    queryKey: ["communities", topic ?? "all", q ?? ""],
    staleTime: 30_000,
  });
}

// The viewer's joined communities, used by the sidebar rail. Lightweight:
// the route skips the browse listing and stats for this call.
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
