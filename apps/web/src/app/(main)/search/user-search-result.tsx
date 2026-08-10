"use client";

import type { UserData } from "@asm/db";
import { Alert, AlertDescription } from "@asm/ui/shadui/alert";
import { Button } from "@asm/ui/shadui/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Users2, VerifiedIcon } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useCallback } from "react";
import EditProfileButton from "@/components/layouts/edit-profile-button";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import Linkify from "@/helpers/global/linkify";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";
import { useSession } from "../session-provider";

interface UsersResponse {
  nextCursor: string | null;
  users: UserData[];
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

export default function UserSearchResults({ query }: { query: string }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status } =
    useInfiniteQuery({
      queryKey: ["user-search", query],
      queryFn: async ({ pageParam }) =>
        kyInstance
          .get("/api/search/users", {
            searchParams: {
              q: query,
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          })
          .json<UsersResponse>(),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: Boolean(query),
    });

  const users = data?.pages.flatMap((page) => page.users) || [];

  const handleLoadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  if (status === "pending") {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[...new Array(4)].map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton array, index is stable
          <UserCardSkeleton key={`skeleton-${i}`} />
        ))}
      </div>
    );
  }

  if (status === "error") {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          An error occurred while loading users.
        </AlertDescription>
      </Alert>
    );
  }

  if (!users.length) {
    return null;
  }

  return (
    <section>
      <div className="mb-6 flex items-center gap-2">
        <Users2 className="h-5 w-5 text-primary" />
        <h2 className="font-bold text-xl">People</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-sm">
          {users.length} results
        </span>
      </div>

      <motion.div
        animate="show"
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
        initial="hidden"
        variants={container}
      >
        {users.map((user) => (
          <UserCard key={user.id} user={user} />
        ))}
      </motion.div>

      {hasNextPage ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="mt-6"
          initial={{ opacity: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Button
            className="w-full"
            disabled={isFetchingNextPage}
            onClick={handleLoadMore}
            variant="outline"
          >
            {isFetchingNextPage ? "Loading more people..." : "Show more people"}
          </Button>
        </motion.div>
      ) : null}
    </section>
  );
}

function UserCard({ user }: { user: UserData }) {
  const { user: sessionUser } = useSession();
  const isOwnProfile = sessionUser.id === user.id;

  return (
    <motion.div
      className="group relative rounded-xl border bg-card transition-all duration-300 hover:bg-muted"
      variants={item}
    >
      <div className="p-4">
        <div className="flex items-start gap-4">
          <Link className="shrink-0" href={`/users/${user.username}`}>
            <UserAvatar
              className="h-16 w-16 ring-2 ring-primary/10 ring-offset-2 ring-offset-background transition-all group-hover:ring-primary/20"
              user={user}
            />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Link
                className="truncate font-medium transition-colors hover:text-primary"
                href={`/users/${user.username}`}
              >
                {user.displayName}
              </Link>
              {user.emailVerified ? (
                <VerifiedIcon className="h-4 w-4 shrink-0 text-primary" />
              ) : null}
            </div>
            <div className="truncate text-muted-foreground text-sm">
              @{user.username}
            </div>
            {user.bio ? (
              <Linkify>
                <p className="mt-2 line-clamp-2 text-muted-foreground text-sm">
                  {user.bio}
                </p>
              </Linkify>
            ) : null}
            <div className="mt-4 flex items-center gap-4 text-sm">
              <span className="text-muted-foreground">
                <span className="font-medium text-foreground">
                  {user._count.followers}
                </span>{" "}
                followers
              </span>
              <span className="text-muted-foreground">
                <span className="font-medium text-foreground">
                  {user._count.posts}
                </span>{" "}
                posts
              </span>
            </div>
            {isOwnProfile && (
              <div className="mt-4">
                <EditProfileButton
                  className="w-full transition-all"
                  user={user}
                />
              </div>
            )}
            {!isOwnProfile && (
              <div className="mt-4">
                <FollowButton
                  className={cn(
                    "w-full transition-all",
                    user.followers.length > 0
                      ? "hover:bg-destructive/10 hover:text-destructive"
                      : "hover:bg-primary/10 hover:text-primary"
                  )}
                  initialState={{
                    followers: user._count.followers,
                    isFollowedByUser: user.followers.length > 0,
                  }}
                  userId={user.id}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function UserCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-4">
        <div className="h-16 w-16 animate-pulse rounded-full bg-muted" />
        <div className="flex-1">
          <div className="h-5 w-32 animate-pulse rounded-sm bg-muted" />
          <div className="mt-2 h-4 w-24 animate-pulse rounded-sm bg-muted" />
          <div className="mt-4 h-8 w-full animate-pulse rounded-sm bg-muted" />
          <div className="mt-4 flex gap-4">
            <div className="h-4 w-20 animate-pulse rounded-sm bg-muted" />
            <div className="h-4 w-16 animate-pulse rounded-sm bg-muted" />
          </div>
          <div className="mt-4 h-9 w-full animate-pulse rounded-sm bg-muted" />
        </div>
      </div>
    </div>
  );
}
