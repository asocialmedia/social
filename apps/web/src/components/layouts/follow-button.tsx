"use client";

import { debugLog } from "@asm/config/debug";
import { Button } from "@asm/ui/shadui/button";
import dynamic from "next/dynamic";
import type React from "react";
import { ErrorBoundary } from "@/components/misc/error-boundary";

const ClientFollowButton = dynamic(
  () => import("./client/client-follow-button"),
  {
    ssr: false,
    loading: () => (
      <Button className="h-8 w-20 animate-pulse rounded-md bg-secondary/50" />
    ),
  }
);

interface FollowButtonProps {
  className?: string;
  initialState: {
    followers: number;
    isFollowedByUser: boolean;
  };
  onFollowed?: () => void;
  userId: string;
}

const WrappedClientFollowButton: React.FC<FollowButtonProps> = (props) => (
  <ErrorBoundary
    onReset={() => {
      debugLog.component("Follow button error boundary reset:", props.userId);
    }}
  >
    <ClientFollowButton {...props} />
  </ErrorBoundary>
);

const FollowButton: React.FC<FollowButtonProps> = ({
  userId,
  initialState,
  className,
  onFollowed,
}) => {
  debugLog.component("Rendering FollowButton:", {
    userId,
    initialState,
    className,
  });

  return (
    <WrappedClientFollowButton
      className={className}
      initialState={initialState}
      onFollowed={onFollowed}
      userId={userId}
    />
  );
};

FollowButton.displayName = "FollowButton";

export default FollowButton;

export function preloadFollowButton() {
  import("./client/client-follow-button");
}
