"use client";

import { Button } from "@asm/ui/shadui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

const followState = z.object({ following: z.boolean() });

export function ExternalFollowButton({
  did,
  className,
  initialFollowing,
  onFollowed,
  showForGuest = false,
}: {
  did: string;
  className?: string;
  initialFollowing?: boolean;
  onFollowed?: () => void;
  showForGuest?: boolean;
}) {
  const auth = useRequireAuth();
  const client = useQueryClient();
  const { toast } = useToast();
  const queryKey = ["external-follow", auth.user?.id ?? "guest", did];
  // Only reaches the query once the component has decided to render, which it
  // does only for a signed-in reader; `isLoggedIn` is therefore true here.
  const state = useQuery({
    enabled: auth.isLoggedIn,
    initialData:
      initialFollowing === undefined
        ? undefined
        : { following: initialFollowing },
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/protocols/bluesky/follows?${new URLSearchParams({ actor: did })}`,
        { signal }
      );
      if (!response.ok) {
        throw new Error("Couldn't load follow state");
      }
      return followState.parse(await response.json());
    },
    queryKey,
    staleTime: 30_000,
  });
  const mutation = useMutation({
    mutationFn: async (active: boolean) => {
      const response = await fetch("/api/protocols/bluesky/follows", {
        body: JSON.stringify({ active, actor: did }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const body: unknown = await response.json();
        const limited =
          body &&
          typeof body === "object" &&
          "error" in body &&
          body.error === "follow_limit";
        throw new Error(
          limited
            ? "You can follow up to 100 Bluesky accounts."
            : "Couldn't update follow. Please try again."
        );
      }
      return followState.parse(await response.json());
    },
    onError: (error) => toast({ title: error.message, variant: "destructive" }),
    onSuccess: async (next) => {
      client.setQueryData(queryKey, next);
      if (next.following) {
        onFollowed?.();
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: ["external-follows"] }),
        client.invalidateQueries({ queryKey: ["bluesky-following"] }),
        client.invalidateQueries({ queryKey: ["bluesky-discovery"] }),
        client.invalidateQueries({ queryKey: ["discovery-suggestions"] }),
      ]);
    },
  });
  // A guest cannot follow, so the control is absent rather than disabled: a
  // greyed button on a stranger's profile is a dead end, while no button is just
  // a page you are reading.
  if (!auth.isLoggedIn) {
    return showForGuest ? (
      <Button
        className={className}
        onClick={() => auth.goToLogin()}
        variant="premium"
      >
        Follow
      </Button>
    ) : null;
  }
  let label = state.data?.following ? "Following" : "Follow";
  if (state.isError) {
    label = "Retry follow";
  }
  return (
    <Button
      className={cn(
        "h-9 rounded-full px-4 text-[13px]! sm:text-sm!",
        className
      )}
      disabled={mutation.isPending || state.isPending}
      onClick={() => {
        if (state.isError) {
          void state.refetch();
        } else {
          mutation.mutate(!state.data?.following);
        }
      }}
      title="Follow on asocialmedia. No linked Bluesky account required."
      variant="premium"
    >
      {label}
    </Button>
  );
}
