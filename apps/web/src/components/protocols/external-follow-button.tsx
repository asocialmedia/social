"use client";

import { Button } from "@asm/ui/shadui/button";
import { DropdownMenuItem } from "@asm/ui/shadui/dropdown-menu";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { UserPlus, UserRoundMinus } from "lucide-react";
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
  menu = false,
}: {
  did: string;
  className?: string;
  initialFollowing?: boolean;
  onFollowed?: () => void;
  showForGuest?: boolean;
  menu?: boolean;
}) {
  const auth = useRequireAuth();
  const client = useQueryClient();
  const { toast } = useToast();
  const sharedPending =
    useIsMutating({
      mutationKey: ["external-follow-write", auth.user?.id ?? "guest", did],
    }) > 0;
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
  const mutation = useMutation<
    z.infer<typeof followState>,
    Error,
    boolean,
    { previous: z.infer<typeof followState> | undefined }
  >({
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
    mutationKey: ["external-follow-write", auth.user?.id ?? "guest", did],
    onError: (error, active, context) => {
      client.setQueryData(
        queryKey,
        context?.previous ?? { following: !active }
      );
      toast({ title: error.message, variant: "destructive" });
    },
    onMutate: async (active) => {
      await client.cancelQueries({ queryKey });
      const previous =
        client.getQueryData<z.infer<typeof followState>>(queryKey);
      client.setQueryData(queryKey, { following: active });
      return { previous };
    },
    onSuccess: async (next) => {
      toast({
        description: next.following
          ? "Posts from this Bluesky account can appear in Following."
          : "Removed from your asocialmedia follows.",
        title: next.following ? "Following in asocialmedia" : "Unfollowed",
      });
      window.dispatchEvent(new Event("network:learned"));
      client.setQueryData(queryKey, next);
      if (next.following) {
        onFollowed?.();
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: ["external-follows"] }),
        client.invalidateQueries({ queryKey: ["profile-user-list"] }),
        client.invalidateQueries({ queryKey: ["user"] }),
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
    if (menu && showForGuest) {
      return (
        <DropdownMenuItem
          className="pill-3d-hover gap-3 rounded-lg px-2 py-2"
          onSelect={() => auth.goToLogin()}
        >
          <UserPlus className="size-4" />
          Follow
        </DropdownMenuItem>
      );
    }
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
  if (menu) {
    const Icon = state.data?.following ? UserRoundMinus : UserPlus;
    return (
      <DropdownMenuItem
        className="pill-3d-hover gap-3 rounded-lg px-2 py-2"
        disabled={sharedPending || mutation.isPending || state.isPending}
        onSelect={() => {
          if (state.isError) {
            void state.refetch();
          } else {
            mutation.mutate(!state.data?.following);
          }
        }}
      >
        <Icon className="size-4" />
        {state.data?.following ? "Unfollow" : label}
      </DropdownMenuItem>
    );
  }
  return (
    <Button
      className={cn(
        "h-9 rounded-full px-4 text-[13px]! sm:text-sm!",
        className
      )}
      disabled={sharedPending || mutation.isPending || state.isPending}
      onClick={() => {
        if (state.isError) {
          void state.refetch();
        } else {
          mutation.mutate(!state.data?.following);
        }
      }}
      title="Follow on asocialmedia. No linked Bluesky account required."
      variant={state.data?.following ? "premium-neutral" : "premium"}
    >
      {label}
    </Button>
  );
}
