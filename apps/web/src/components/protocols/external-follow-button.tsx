"use client";

import { Button } from "@asm/ui/shadui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { useToast } from "@/lib/gooey-toast";

const followState = z.object({ following: z.boolean() });

export function ExternalFollowButton({ did }: { did: string }) {
  const auth = useRequireAuth();
  const client = useQueryClient();
  const { toast } = useToast();
  const queryKey = ["external-follow", auth.user?.id ?? "guest", did];
  const state = useQuery({
    enabled: auth.isLoggedIn,
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
      await Promise.all([
        client.invalidateQueries({ queryKey: ["external-follows"] }),
        client.invalidateQueries({ queryKey: ["bluesky-following"] }),
        client.invalidateQueries({ queryKey: ["bluesky-discovery"] }),
      ]);
    },
  });
  let label = state.data?.following ? "Following in ASM" : "Follow in ASM";
  if (state.isError) {
    label = "Retry follow";
  }
  return (
    <Button
      className="rounded-full text-xs sm:text-sm"
      disabled={mutation.isPending || (auth.isLoggedIn && state.isPending)}
      onClick={() => {
        if (!auth.isLoggedIn) {
          auth.goToLogin();
        } else if (state.isError) {
          void state.refetch();
        } else {
          mutation.mutate(!state.data?.following);
        }
      }}
      title="Follow in asocialmedia. No linked Bluesky account required."
      variant="premium"
    >
      {label}
    </Button>
  );
}
