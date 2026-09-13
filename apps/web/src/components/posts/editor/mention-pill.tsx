"use client";

import type { UserData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { HTTPError } from "ky";

import UserAvatar from "@/components/layouts/user-avatar";
import kyInstance from "@/lib/ky";

// Editor-side rendering for a mention pill. Rehydrated mentions (from a stored
// bio/draft) carry only the username, so the pill resolves the avatar lazily by
// username - the same cache entry the hover tooltip uses. Freshly-picked
// mentions already carry the avatar and skip the lookup.
export function MentionPill({ node }: NodeViewProps) {
  const username =
    typeof node.attrs.username === "string" ? node.attrs.username : "";
  const storedAvatar =
    typeof node.attrs.avatarUrl === "string" ? node.attrs.avatarUrl : "";
  const id = typeof node.attrs.id === "string" ? node.attrs.id : "";

  const { data } = useQuery({
    enabled: Boolean(username) && storedAvatar.length === 0,
    queryFn: () =>
      kyInstance.get(`/api/users/username/${username}`).json<UserData>(),
    queryKey: ["user-data", username],
    retry(failureCount, error) {
      if (error instanceof HTTPError) {
        const { status } = error.response;
        if (status === 401 || status === 404) {
          return false;
        }
      }
      return failureCount < 2;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

  const avatarUrl = storedAvatar || data?.avatarUrl || null;

  return (
    <NodeViewWrapper
      as="span"
      className="meta-chip meta-chip-mention editor-inline-pill"
      data-mention-id={id}
      data-mention-username={username}
    >
      <UserAvatar
        avatarUrl={avatarUrl}
        className="editor-inline-pill-avatar"
        size={14}
        user={data}
      />
      <span>@{username}</span>
    </NodeViewWrapper>
  );
}
