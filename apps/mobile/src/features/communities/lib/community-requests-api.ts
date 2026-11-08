// Client for a community's membership-request queue, the same routes web's
// CommunityJoinRequests dialog reads (`/api/communities/:slug/membership-requests`).
import { z } from "zod";

import { networkRequest } from "@/features/network/lib/network-api";

export const communityJoinRequestPageSchema = z.object({
  nextCursor: z.string().nullable(),
  requests: z.array(
    z.object({
      createdAt: z.string(),
      id: z.string(),
      user: z
        .object({
          avatarUrl: z.string().nullable(),
          displayName: z.string(),
          id: z.string(),
          username: z.string(),
        })
        .nullable(),
    })
  ),
  total: z.number().int().nonnegative(),
});

export type CommunityJoinRequestPage = z.infer<
  typeof communityJoinRequestPageSchema
>;
export type CommunityJoinRequest = CommunityJoinRequestPage["requests"][number];
export type CommunityRequestDecision = "approve" | "decline";

const decisionResultSchema = z.object({ applied: z.boolean().optional() });

export function communityRequestsPath(slug: string, cursor?: string | null) {
  const base = `/api/communities/${encodeURIComponent(slug)}/membership-requests`;
  return cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
}

export async function fetchCommunityJoinRequests(
  slug: string,
  cursor: string | null,
  signal?: AbortSignal
): Promise<CommunityJoinRequestPage> {
  return communityJoinRequestPageSchema.parse(
    await networkRequest(communityRequestsPath(slug, cursor), { signal })
  );
}

export async function decideCommunityJoinRequest(
  slug: string,
  requestId: string,
  decision: CommunityRequestDecision
): Promise<{ applied: boolean }> {
  const result = decisionResultSchema.parse(
    await networkRequest(
      `${communityRequestsPath(slug)}/${encodeURIComponent(requestId)}`,
      { body: JSON.stringify({ decision }), method: "PATCH" }
    )
  );
  return { applied: result.applied === true };
}

// Web's toast titles for a decision outcome.
export function communityDecisionTitle(
  decision: CommunityRequestDecision,
  applied: boolean
): string {
  if (!applied) {
    return "Request already resolved";
  }
  return decision === "approve" ? "Member approved" : "Request declined";
}

// Pages merge in order; a request decided on this device is dropped from the
// list and the total so the header count stays honest before the refetch.
export function mergeCommunityRequestPages(
  pages: readonly CommunityJoinRequestPage[],
  decidedIds: ReadonlySet<string>
): { requests: CommunityJoinRequest[]; total: number | undefined } {
  const seen = new Set<string>();
  const requests: CommunityJoinRequest[] = [];
  for (const page of pages) {
    for (const request of page.requests) {
      if (!request.user || seen.has(request.id) || decidedIds.has(request.id)) {
        continue;
      }
      seen.add(request.id);
      requests.push(request);
    }
  }
  const [first] = pages;
  const total = first
    ? Math.max(0, first.total - countDecidedOnPages(pages, decidedIds))
    : undefined;
  return { requests, total };
}

function countDecidedOnPages(
  pages: readonly CommunityJoinRequestPage[],
  decidedIds: ReadonlySet<string>
): number {
  let count = 0;
  for (const id of decidedIds) {
    if (pages.some((page) => page.requests.some((entry) => entry.id === id))) {
      count += 1;
    }
  }
  return count;
}

// Staff of a non-public community can review requests, as in web's header.
export function canReviewCommunityRequests(
  communityType: string,
  membership: { role: string; status: string } | null
): boolean {
  return (
    communityType !== "PUBLIC" &&
    membership?.status === "ACTIVE" &&
    (membership.role === "OWNER" || membership.role === "MODERATOR")
  );
}
