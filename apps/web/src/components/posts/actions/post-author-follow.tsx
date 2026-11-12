"use client";

import { canFollowPostAuthor } from "@asm/protocols/discovery";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { useSession } from "@/app/(main)/session-provider";
import FollowButton from "@/components/layouts/user/follow-button";
import { ExternalFollowButton } from "@/components/protocols/external-follow-button";
import type { PresentedPost } from "@/lib/posts/presentation";

const connectionSchema = z.object({
  canLike: z.boolean(),
  canReply: z.boolean(),
  connected: z.boolean(),
  did: z.string().nullable(),
});

export function PostAuthorFollow({
  post,
  menu = false,
}: {
  post: PresentedPost;
  menu?: boolean;
}) {
  const { user } = useSession();
  const connection = useQuery({
    enabled: Boolean(user && post.external),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/protocols/bluesky/likes", { signal });
      if (!response.ok) {
        throw new Error("Couldn't check your Bluesky account");
      }
      return connectionSchema.parse(await response.json());
    },
    queryKey: ["bluesky-connection", user?.id ?? "guest"],
    staleTime: 30_000,
  });
  if (
    !canFollowPostAuthor({
      authorId: post.user?.id,
      connectionKnown: Boolean(connection.data),
      externalDid: post.external?.author.id,
      viewerDid: connection.data?.did,
      viewerId: user?.id,
    })
  ) {
    return null;
  }

  if (post.external) {
    return (
      <ExternalFollowButton
        did={post.external.author.id}
        menu={menu}
        showForGuest
        className="relative z-10 h-8! shrink-0 rounded-full px-4 text-xs!"
      />
    );
  }
  return (
    <FollowButton
      menu={menu}
      userId={post.user.id}
      className="relative z-10 h-8 shrink-0 rounded-full px-4 text-xs"
      initialState={{
        followers: post.user.followers.length,
        isFollowedByUser: post.user.followers.length > 0,
      }}
    />
  );
}
