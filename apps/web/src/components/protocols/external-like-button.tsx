"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
import { Button } from "@asm/ui/shadui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Heart } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInView } from "react-intersection-observer";
import { z } from "zod";

import { useSession } from "@/app/(main)/session-provider";
import { trackNetworkAction } from "@/components/recommendations/recommendation-tracker";
import { useToast } from "@/lib/gooey-toast";
import { cn, formatNumber } from "@/lib/utils";

import { BlueskyIcon } from "./bluesky-icon";

const settingsHref = "/settings?tab=account#settings-bluesky-connection";
const connectionSchema = z.object({
  canLike: z.boolean(),
  canReply: z.boolean(),
  connected: z.boolean(),
  did: z.string().nullable(),
});
const likeSchema = z.object({
  liked: z.boolean(),
  likes: z.number().nonnegative().nullable(),
});

export function ExternalLikeButton({
  post,
  className,
  iconClassName,
  interactive = true,
}: {
  post: ExternalPost;
  className?: string;
  iconClassName?: string;
  interactive?: boolean;
}) {
  const { user } = useSession();
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();
  const { ref, inView } = useInView({ rootMargin: "200px", triggerOnce: true });
  const viewer = user?.id ?? "guest";
  const connection = useQuery({
    enabled: interactive && Boolean(user) && inView,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/protocols/bluesky/likes", {
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        throw new Error("Couldn't check Bluesky connection");
      }
      return connectionSchema.parse(await response.json());
    },
    queryKey: ["bluesky-connection", viewer],
    staleTime: 30_000,
  });
  const key = ["bluesky-like", viewer, connection.data?.did, post.id];
  const canLike = Boolean(user && connection.data?.canLike);
  const state = useQuery({
    enabled: interactive && canLike && inView,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/protocols/bluesky/likes?${new URLSearchParams({ uri: post.id })}`,
        { cache: "no-store", signal }
      );
      if (!response.ok) {
        throw new Error("Couldn't load your Bluesky like");
      }
      return likeSchema.parse(await response.json());
    },
    queryKey: key,
    retry: false,
    staleTime: 30_000,
  });
  const mutation = useMutation({
    mutationFn: async (active: boolean) => {
      const response = await fetch("/api/protocols/bluesky/likes", {
        body: JSON.stringify({ active, uri: post.id }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error(
          response.status === 409
            ? "Reconnect Bluesky in settings to enable likes."
            : "Couldn't sync your like to Bluesky. Please try again."
        );
      }
      return likeSchema.parse(await response.json());
    },
    mutationKey: key,
    onError: (error) => toast({ title: error.message, variant: "destructive" }),
    onSuccess: (next) => {
      client.setQueryData(key, next);
      if (next.liked) {
        trackNetworkAction(post.id, "VOTE");
      }
    },
  });
  const pending = useIsMutating({ mutationKey: key }) > 0;
  const liked = state.data?.liked ?? false;
  const count = state.data?.likes ?? post.upstreamCounts.likes ?? null;
  const checking =
    (Boolean(user) && connection.isLoading) || (canLike && state.isLoading);
  let label = connection.data?.connected
    ? "Reconnect Bluesky to like"
    : "Connect Bluesky to like";
  if (canLike) {
    label = liked ? "Unlike on Bluesky" : "Like on Bluesky";
  }
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={label}
            aria-pressed={canLike ? liked : undefined}
            className={cn(
              "text-muted-foreground focus-visible:ring-ring inline-flex items-center justify-center gap-1 rounded-full px-1.5 py-1 text-xs font-semibold tabular-nums transition-colors outline-none focus-visible:ring-2 disabled:opacity-50",
              canLike && liked && "text-rose-500",
              !canLike && "opacity-50",
              className
            )}
            disabled={
              !interactive || checking || pending || (canLike && state.isError)
            }
            onClick={(event) => {
              event.stopPropagation();
              if (canLike) {
                mutation.mutate(!liked);
              } else {
                router.push(settingsHref);
              }
            }}
            ref={ref}
            type="button"
          >
            <Heart
              aria-hidden
              className={cn(
                "size-4 sm:size-4.5",
                liked && canLike && "fill-current",
                iconClassName
              )}
            />
            <span>{count === null ? "—" : formatNumber(count)}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          className={cn(
            "max-w-64 space-y-3 p-4",
            !canLike && "border-white/20 bg-[#0085ff] text-white"
          )}
          onClick={(event) => event.stopPropagation()}
        >
          {canLike ? null : (
            <BlueskyIcon tooltip={false} className="size-7 text-white" />
          )}
          <p className="text-sm">
            {canLike
              ? "Likes sync with your connected Bluesky account."
              : "Liking works when your Bluesky account is connected."}
          </p>
          {canLike ? null : (
            <Button
              asChild
              className="w-full border-white bg-white text-[#0085ff] shadow-none hover:bg-white/90"
              size="sm"
              variant="secondary"
            >
              <Link href={settingsHref}>
                {connection.data?.connected
                  ? "Reconnect Bluesky"
                  : "Connect Bluesky"}
              </Link>
            </Button>
          )}
          {canLike && state.isError ? (
            <Button
              size="sm"
              onClick={() => {
                void state.refetch();
              }}
            >
              Retry
            </Button>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
