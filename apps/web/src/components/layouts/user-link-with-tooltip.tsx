"use client";

import { useQuery } from "@tanstack/react-query";
import type { UserData } from "@asm/db";
import { HTTPError } from "ky";
import Link from "next/link";
import type { PropsWithChildren } from "react";
import kyInstance from "@/lib/ky";
import UserTooltip from "./user-tooltip";

interface UserLinkWithTooltipProps extends PropsWithChildren {
  username: string;
}

export default function UserLinkWithTooltip({
  children,
  username,
}: UserLinkWithTooltipProps) {
  const { data } = useQuery({
    queryKey: ["user-data", username],
    queryFn: () =>
      kyInstance.get(`/api/users/username/${username}`).json<UserData>(),
    retry(failureCount, error) {
      if (error instanceof HTTPError && error.response.status === 404) {
        return false;
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
