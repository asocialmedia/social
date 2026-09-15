"use client";

import { Button } from "@asm/ui/shadui/button";
import { useCallback, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import {
  useJoinCommunityMutation,
  useLeaveCommunityMutation,
} from "@/communities/mutations";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { cn } from "@/lib/utils";

interface JoinButtonProps {
  className?: string;
  communityId: string;
  initialMembership: {
    role: "MEMBER" | "MODERATOR" | "OWNER";
    status: "ACTIVE" | "PENDING";
  } | null;
  isLoggedIn: boolean;
  slug: string;
}

// Join / leave control. The owner can never leave (the server enforces this);
// the button renders a non-interactive "Owner" state instead. A PENDING
// membership shows "Requested" so the state reads honestly.
export default function JoinButton({
  className,
  communityId,
  initialMembership,
  isLoggedIn: isLoggedInProp,
  slug,
}: JoinButtonProps) {
  const { user } = useSession();
  const isLoggedIn = isLoggedInProp || Boolean(user);
  const { goToLogin } = useRequireAuth();
  const joinMutation = useJoinCommunityMutation(slug);
  const leaveMutation = useLeaveCommunityMutation(slug);

  // Mirror the server membership locally so the button flips immediately after
  // a join/leave without waiting for the parent to re-render.
  const [membership, setMembership] = useState(initialMembership);
  const [prevInitial, setPrevInitial] = useState(initialMembership);
  if (prevInitial !== initialMembership) {
    setPrevInitial(initialMembership);
    setMembership(initialMembership);
  }

  const isOwner = membership?.role === "OWNER";
  const isActive = membership?.status === "ACTIVE";
  const isPending = membership?.status === "PENDING";
  const isBusy = joinMutation.isPending || leaveMutation.isPending;

  const handleClick = useCallback(() => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    if (isActive) {
      leaveMutation.mutate(communityId, {
        onSuccess: () => setMembership(null),
      });
      return;
    }
    joinMutation.mutate(communityId, {
      onSuccess: (data) =>
        setMembership(
          data?.status
            ? { role: "MEMBER", status: data.status }
            : { role: "MEMBER", status: "ACTIVE" }
        ),
    });
  }, [
    communityId,
    goToLogin,
    isActive,
    isLoggedIn,
    joinMutation,
    leaveMutation,
  ]);

  if (isOwner) {
    return (
      <Button
        className={cn("w-full", className)}
        disabled
        size="sm"
        variant="secondary"
      >
        Owner
      </Button>
    );
  }

  let label = "Join";
  let variant: "default" | "outline" | "secondary" = "default";
  if (isActive) {
    label = "Joined";
    variant = "outline";
  } else if (isPending) {
    label = "Requested";
    variant = "secondary";
  }

  return (
    <Button
      className={cn("w-full", className)}
      disabled={isBusy}
      onClick={handleClick}
      size="sm"
      variant={variant}
    >
      {label}
    </Button>
  );
}
