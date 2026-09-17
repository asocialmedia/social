"use client";

import { Button } from "@asm/ui/shadui/button";
import { useCallback, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import {
  useJoinCommunityMutation,
  useLeaveCommunityMutation,
} from "@/communities/mutations";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import type { CommunityRoleValue } from "@/lib/communities/client";
import { cn } from "@/lib/utils";

interface JoinButtonProps {
  className?: string;
  communityId: string;
  initialMembership: {
    role: CommunityRoleValue;
    status: "ACTIVE" | "PENDING";
  } | null;
  isLoggedIn: boolean;
  slug: string;
}

// Compact 3D pill metrics shared by every state. `size="sm"` already supplies
// h-8 and text-xs; these classes then swap the flat shadcn radius for the pill
// and neutralize `variant="premium"`'s roomier px-8/py-3. The padding uses
// `!` because same-property utilities resolve by CSS source order, which is not
// something to rely on at a call site.
const BUTTON_METRICS = "rounded-full px-3.5! py-0! text-xs!";

// Join / leave control. A PENDING membership shows "Requested" so the state
// reads honestly. Owners never see this control (the header omits it, since
// they cannot leave their own community); the server enforces the same rule.
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
            ? { role: "PARTICIPANT", status: data.status }
            : { role: "PARTICIPANT", status: "ACTIVE" }
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

  let label = "Join";
  // Join is the orange primary; every settled state (Joined / Requested) is the
  // neutral 3D pill, so the control quiets down once the action is spent.
  let variant: "premium" | "ghost" = "premium";
  if (isActive) {
    label = "Joined";
    variant = "ghost";
  } else if (isPending) {
    label = "Requested";
    variant = "ghost";
  }

  return (
    <Button
      className={cn(
        BUTTON_METRICS,
        variant === "ghost" && "btn-3d-gray",
        "w-full",
        className
      )}
      disabled={isBusy}
      onClick={handleClick}
      size="sm"
      variant={variant}
    >
      {label}
    </Button>
  );
}
