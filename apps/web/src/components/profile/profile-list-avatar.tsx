"use client";

import type { ProfileUserListData } from "@asm/ui/lib/user-list";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import { useInView } from "react-intersection-observer";

import UserAvatar from "@/components/layouts/user/user-avatar";
import { useBlueskyProfile } from "@/components/protocols/use-bluesky-profile";

type ListAvatarUser = Pick<
  ProfileUserListData,
  "id" | "avatarUrl" | "source" | "status" | "username"
>;

function BlueskyListAvatar({ user }: { user: ListAvatarUser }) {
  const { ref, inView } = useInView({ rootMargin: "300px", triggerOnce: true });
  const available = !user.status || user.status === "active";
  const profile = useBlueskyProfile(user.id, undefined, available && inView);
  const avatarUrl = profile.data?.avatarUrl ?? user.avatarUrl;
  return (
    <span ref={ref} className="block size-11 shrink-0">
      {available && !avatarUrl && profile.isPending ? (
        <Skeleton
          aria-label={`Loading avatar for @${user.username}`}
          className="size-11 rounded-[30%]"
        />
      ) : (
        <UserAvatar
          key={avatarUrl ?? user.id}
          avatarUrl={avatarUrl}
          seed={user.id}
          size={44}
          className="size-11"
        />
      )}
    </span>
  );
}

export function ProfileListAvatar({ user }: { user: ListAvatarUser }) {
  return user.source === "bluesky" ? (
    <BlueskyListAvatar user={user} />
  ) : (
    <UserAvatar
      avatarUrl={user.avatarUrl}
      seed={user.id}
      size={44}
      className="size-11"
    />
  );
}
