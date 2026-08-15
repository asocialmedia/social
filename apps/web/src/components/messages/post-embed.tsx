"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

interface PostEmbedProps {
  mine: boolean;
  postId: string;
}

export function PostEmbed({ mine, postId }: PostEmbedProps) {
  const { data, isError } = useQuery({
    queryFn: async () => {
      const response = await fetch(`/api/posts/${postId}`);
      if (!response.ok) {
        throw new Error("not found");
      }
      const json = (await response.json()) as {
        post: { content: string; isGust: boolean };
      };
      return json.post;
    },
    queryKey: ["message-post-embed", postId],
    retry: 1,
  });

  if (isError) {
    return (
      <span className="text-xs italic opacity-70">
        <FileText className="mr-1 inline h-3.5 w-3.5" />
        Post no longer available
      </span>
    );
  }

  const href = data?.isGust ? `/gusts?id=${postId}` : `/posts/${postId}`;

  return (
    <Link
      className={cn(
        "mt-1 block max-w-64 rounded-xl border p-2.5 text-left transition-transform hover:scale-[1.01]",
        mine
          ? "border-white/30 bg-white/10"
          : "border-border/60 bg-[hsl(var(--background-alt))]"
      )}
      href={href}
    >
      <span
        className={cn(
          "mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase",
          mine ? "text-white/80" : "text-muted-foreground"
        )}
      >
        <FileText className="h-3 w-3" />
        {data?.isGust ? "Gust" : "Post"}
      </span>
      <span
        className={cn(
          "line-clamp-2 text-xs font-medium",
          mine ? "text-white" : "text-foreground"
        )}
      >
        {data?.content || "Loading…"}
      </span>
    </Link>
  );
}
