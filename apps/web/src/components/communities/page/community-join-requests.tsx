"use client";

import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@asm/ui/shadui/dialog";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user/user-avatar";
import { useToast } from "@/lib/gooey-toast";

type RequestDecision = "approve" | "decline";
interface RequestPage {
  requests: {
    id: string;
    createdAt: string;
    user: {
      id: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
    } | null;
  }[];
  nextCursor: string | null;
  total: number;
}

export function useCommunityRequestDecision(slug: string) {
  const client = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({
      requestId,
      decision,
    }: {
      requestId: string;
      decision: RequestDecision;
    }) => {
      const response = await fetch(
        `/api/communities/${slug}/membership-requests/${requestId}`,
        {
          body: JSON.stringify({ decision }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }
      );
      const result = (await response.json()) as {
        applied?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Couldn't review this request");
      }
      return result;
    },
    onError: (error) =>
      toast({
        description: error.message,
        title: "Couldn't review request",
        variant: "destructive",
      }),
    onSettled: () =>
      client.invalidateQueries({
        queryKey: ["community-request-status", slug],
      }),
    onSuccess: (result, variables) => {
      let title = "Request already resolved";
      if (result.applied) {
        title =
          variables.decision === "approve"
            ? "Member approved"
            : "Request declined";
      }
      toast({ title });
      for (const queryKey of [
        ["community-requests", slug],
        ["community-request-status", slug],
        ["community-members", slug],
        ["community", slug],
        ["community-joined"],
        ["communities"],
        ["notifications"],
      ]) {
        void client.invalidateQueries({ queryKey });
      }
    },
  });
}

export function CommunityRequestNotificationActions({
  slug,
  requestId,
}: {
  slug: string;
  requestId: string;
}) {
  const { user } = useSession();
  const decision = useCommunityRequestDecision(slug);
  const status = useQuery({
    queryFn: async () => {
      const response = await fetch(
        `/api/communities/${slug}/membership-requests/${requestId}`,
        { cache: "no-store" }
      );
      if (response.status === 404 || response.status === 403) {
        return { canDecide: false, pending: false };
      }
      if (!response.ok) {
        throw new Error("Couldn't check request status");
      }
      return response.json() as Promise<{
        pending: boolean;
        canDecide: boolean;
      }>;
    },
    queryKey: ["community-request-status", slug, user?.id, requestId],
    staleTime: 0,
  });
  if (status.isPending) {
    return (
      <output className="text-muted-foreground px-4 pb-3 text-xs">
        Checking request…
      </output>
    );
  }
  if (status.isError) {
    return (
      <Button
        variant="ghost"
        onClick={() => {
          void status.refetch();
        }}
      >
        Retry request status
      </Button>
    );
  }
  if (!status.data?.canDecide) {
    return null;
  }
  if (!status.data.pending) {
    return (
      <p className="text-muted-foreground px-4 pb-3 text-xs">
        This request is no longer pending.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2 px-4 pb-3 pl-[4.25rem]">
      <Button
        className="min-h-11"
        size="sm"
        variant="premium"
        disabled={decision.isPending}
        onClick={() => decision.mutate({ decision: "approve", requestId })}
      >
        Accept
      </Button>
      <Button
        className="min-h-11"
        size="sm"
        variant="ghost"
        disabled={decision.isPending}
        onClick={() => decision.mutate({ decision: "decline", requestId })}
      >
        Decline
      </Button>
    </div>
  );
}

export default function CommunityJoinRequests({
  slug,
  openOnLink = true,
}: {
  slug: string;
  openOnLink?: boolean;
}) {
  const { user } = useSession();
  const descriptionId = useId();
  const search = useSearchParams();
  const [open, setOpen] = useState(
    openOnLink && search.get("requests") === "1"
  );
  const requestsLink = search.get("requests");
  const [previousRequestsLink, setPreviousRequestsLink] =
    useState(requestsLink);
  if (previousRequestsLink !== requestsLink) {
    setPreviousRequestsLink(requestsLink);
    if (openOnLink && requestsLink === "1") {
      setOpen(true);
    }
  }
  const query = useInfiniteQuery({
    getNextPageParam: (page: RequestPage) => page.nextCursor,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const response = await fetch(
        `/api/communities/${slug}/membership-requests${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error("Couldn't load join requests");
      }
      return response.json() as Promise<RequestPage>;
    },
    queryKey: ["community-requests", slug, user?.id],
    refetchInterval: open ? 30_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const decision = useCommunityRequestDecision(slug);
  const total = query.data?.pages[0]?.total;
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          void query.refetch();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button className="min-h-11 gap-2" variant="ghost" size="sm">
          <Users className="size-4" />
          Join requests
          {total ? (
            <span className="chip-3d min-w-5 px-1.5 text-xs tabular-nums">
              {total}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[85dvh] flex-col sm:max-w-xl"
        aria-describedby={descriptionId}
      >
        <DialogHeader>
          <DialogTitle>
            Join requests{total === undefined ? "" : ` (${total})`}
          </DialogTitle>
        </DialogHeader>
        <p id={descriptionId} className="text-muted-foreground text-sm">
          Review who can access a/{slug}. Accepted members can read posts and
          join community chat.
        </p>
        <div className="min-h-0 overflow-y-auto">
          {query.isLoading ? (
            <output className="py-6 text-sm">Loading requests…</output>
          ) : null}
          {query.isError ? (
            <div role="alert" className="py-4 text-sm">
              Couldn't load requests.{" "}
              <Button
                variant="ghost"
                onClick={() => {
                  void query.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {total === 0 ? (
            <p className="text-muted-foreground py-6 text-sm">
              You're all caught up. No pending requests.
            </p>
          ) : null}
          <ul className="divide-border/60 divide-y">
            {query.data?.pages
              .flatMap((page) => page.requests)
              .map((request) =>
                request.user ? (
                  <li
                    key={request.id}
                    className="flex flex-wrap items-center gap-3 py-3"
                  >
                    <Link
                      href={`/users/${request.user.username}`}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <UserAvatar
                        avatarUrl={request.user.avatarUrl}
                        seed={request.user.id}
                        className="size-10"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {request.user.displayName || request.user.username}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          @{request.user.username}
                        </span>
                      </span>
                    </Link>
                    <div className="flex gap-2">
                      <Button
                        className="min-h-11"
                        variant="premium"
                        size="sm"
                        disabled={decision.isPending}
                        onClick={() =>
                          decision.mutate({
                            decision: "approve",
                            requestId: request.id,
                          })
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        className="min-h-11"
                        variant="ghost"
                        size="sm"
                        disabled={decision.isPending}
                        onClick={() =>
                          decision.mutate({
                            decision: "decline",
                            requestId: request.id,
                          })
                        }
                      >
                        Decline
                      </Button>
                    </div>
                  </li>
                ) : null
              )}
          </ul>
          {query.hasNextPage ? (
            <Button
              className="my-3 min-h-11 w-full"
              variant="ghost"
              disabled={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage();
              }}
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more requests"}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
