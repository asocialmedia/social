"use client";

import type { UserData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import { HTTPError } from "ky";
import Link from "next/link";
import type { PropsWithChildren } from "react";

import { useSession } from "@/app/(main)/session-provider";
import kyInstance from "@/lib/ky";

import UserTooltip from "./user-tooltip";

interface UserLinkWithTooltipProps extends PropsWithChildren {
  username: string;
}

export default function UserLinkWithTooltip({
  children,
  username,
}: UserLinkWithTooltipProps) {
  // The tooltip fetch is an auth-only nicety; guests don't need it, and the
  // endpoint 401s without a session. Skipping it avoids a storm of failed
  // requests whenever a feed post mentions many users.
  const { user } = useSession();
  const { data } = useQuery({
    enabled: !!user,
    queryFn: () =>
      kyInstance.get(`/api/users/username/${username}`).json<UserData>(),
    queryKey: ["user-data", username],
    retry(failureCount, error) {
      if (error instanceof HTTPError) {
        const { status } = error.response;
        // Auth failures (401) and missing users (404) won't succeed on retry.
        if (status === 401 || status === 404) {
          return false;
        }
      }
      return failureCount < 3;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (!data) {
    return (
      <Link
        className="text-primary hover:underline"
        href={`/users/${username}`}
      >
        {children}
      </Link>
    );
  }

  return (
    <UserTooltip user={data}>
      <Link
        className="text-primary hover:underline"
        href={`/users/${username}`}
      >
        {children}
      </Link>
    </UserTooltip>
  );
}
