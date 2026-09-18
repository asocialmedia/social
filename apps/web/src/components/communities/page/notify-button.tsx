"use client";

import { Bell, BellOff } from "lucide-react";
import { useCallback, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { useCommunitySubscriptionMutation } from "@/communities/mutations";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { cn } from "@/lib/utils";

interface CommunityNotifyButtonProps {
  className?: string;
  communityId: string;
  // The viewer's subscription state, rendered server-side so the bell shows the
  // correct state on first paint instead of flickering from "off".
  initialSubscribed: boolean;
  isLoggedIn: boolean;
  slug: string;
}

// Notify-me bell, sitting beside Join. Subscribing is independent of
// membership: it routes the community's new posts into the viewer's Latest feed
// and raises a batched notification. A round icon button (the app's
// `icon-btn-3d`) rather than a second labelled pill, so it reads as a secondary
// control next to the primary Join action.
export default function CommunityNotifyButton({
  className,
  communityId,
  initialSubscribed,
  isLoggedIn: isLoggedInProp,
  slug,
}: CommunityNotifyButtonProps) {
  const { user } = useSession();
  const isLoggedIn = isLoggedInProp || Boolean(user);
  const { goToLogin } = useRequireAuth();
  const subscriptionMutation = useCommunitySubscriptionMutation(
    communityId,
    slug
  );

  // Mirror the server state locally so the bell flips immediately, matching the
  // JoinButton's pattern.
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [prevInitial, setPrevInitial] = useState(initialSubscribed);
  if (prevInitial !== initialSubscribed) {
    setPrevInitial(initialSubscribed);
    setSubscribed(initialSubscribed);
  }

  const handleClick = useCallback(() => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    const next = !subscribed;
    subscriptionMutation.mutate(next, {
      onSuccess: () => setSubscribed(next),
    });
  }, [goToLogin, isLoggedIn, subscribed, subscriptionMutation]);

  return (
    <button
      aria-label={
        subscribed
          ? `Turn off notifications for a/${slug}`
          : `Get notified about new posts in a/${slug}`
      }
      aria-pressed={subscribed}
      className={cn(
        "icon-btn-3d flex size-8 shrink-0 items-center justify-center rounded-full",
        subscribed && "icon-btn-3d-active",
        className
      )}
      disabled={subscriptionMutation.isPending}
      onClick={handleClick}
      title={
        subscribed
          ? `Notifications on for a/${slug}`
          : `Notify me about a/${slug}`
      }
      type="button"
    >
      {subscribed ? (
        <Bell aria-hidden="true" className="size-4" fill="currentColor" />
      ) : (
        <BellOff aria-hidden="true" className="text-muted-foreground size-4" />
      )}
    </button>
  );
}
