"use client";

import { Button } from "@asm/ui/shadui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { z } from "zod";

import { FeedErrorState } from "@/components/feeds/feed-error-state";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { useToast } from "@/lib/gooey-toast";
import { blueskyProfilePath } from "@/lib/protocols/paths";

const authorsSchema = z.object({
  authors: z
    .array(
      z.object({
        did: z.string(),
        displayName: z.string(),
        handle: z.string(),
        status: z.string(),
      })
    )
    .max(100),
});

export function ExternalFollowingList() {
  const { user } = useRequireAuth();
  const client = useQueryClient();
  const { toast } = useToast();
  const queryKey = ["external-follows", user?.id ?? "guest"];
  const query = useQuery({
    enabled: Boolean(user),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/protocols/bluesky/follows", {
        signal,
      });
      if (!response.ok) {
        throw new Error("Couldn't load followed accounts");
      }
      return authorsSchema.parse(await response.json());
    },
    queryKey,
  });
  const remove = useMutation({
    mutationFn: async (did: string) => {
      const response = await fetch("/api/protocols/bluesky/follows", {
        body: JSON.stringify({ active: false, actor: did }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error("Couldn't unfollow. Please try again.");
      }
      return did;
    },
    onError: (error) => toast({ title: error.message, variant: "destructive" }),
    onSuccess: async (did) => {
      toast({
        description: "Removed from your asocialmedia follows.",
        title: "Unfollowed",
      });
      window.dispatchEvent(new Event("network:learned"));
      client.setQueryData(["external-follow", user?.id, did], {
        following: false,
      });
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        client.invalidateQueries({ queryKey: ["bluesky-following"] }),
        client.invalidateQueries({ queryKey: ["bluesky-discovery"] }),
      ]);
    },
  });
  return (
    <section className="surface-3d space-y-3 rounded-xl p-4">
      <h3 className="font-semibold">Bluesky accounts followed in ASM</h3>
      <p className="text-muted-foreground text-xs">
        No linked Bluesky account required. These follows stay in ASM, including
        when you disconnect Bluesky.
      </p>
      {query.isPending ? (
        <p className="text-muted-foreground text-sm">
          Loading followed accounts…
        </p>
      ) : null}
      {query.isError ? (
        <FeedErrorState
          message="Couldn't load followed Bluesky accounts."
          isRetrying={query.isFetching}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}
      {query.data?.authors.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Visit a Bluesky profile in ASM and choose Follow.
        </p>
      ) : null}
      {query.data?.authors.map((author) => (
        <div
          className="flex items-center justify-between gap-3"
          key={author.did}
        >
          <Link
            className="min-w-0 truncate text-sm"
            href={blueskyProfilePath(author.did)}
          >
            {author.displayName || author.handle}
            <span className="text-muted-foreground block truncate text-xs">
              @{author.handle}
              {author.status === "active" ? "" : ` · ${author.status}`}
            </span>
          </Link>
          <Button
            variant="premium"
            className="shrink-0 rounded-full text-xs"
            disabled={remove.isPending}
            onClick={() => remove.mutate(author.did)}
          >
            Unfollow
          </Button>
        </div>
      ))}
    </section>
  );
}
