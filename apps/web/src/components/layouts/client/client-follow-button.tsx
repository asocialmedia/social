"use client";

import { debugLog } from "@asm/config/debug";
import type { FollowerInfo } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai/react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import {
  useFollowUserMutation,
  useUnfollowUserMutation,
} from "@/hooks/user-mutations";
import { cn } from "@/lib/utils";
import { followStateAtom } from "./follow-state";

interface ClientFollowButtonProps {
  className?: string;
  initialState: {
    followers: number;
    isFollowedByUser: boolean;
  };
  onFollowed?: () => void;
  userId: string;
}

const LoadingPulse = () => (
  <div className="flex items-center justify-center space-x-1">
    {[...new Array(3)].map((_, i) => (
      <motion.div
        animate={{
          scale: [0.8, 1.2, 0.8],
          opacity: [0.6, 1, 0.6],
        }}
        className="h-1.5 w-1.5 rounded-full bg-current"
        initial={{ scale: 0.8, opacity: 0.6 }}
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton loading animation uses index-based keys
        key={`loading-pulse-${i}`}
        transition={{
          duration: 1,
          repeat: Number.POSITIVE_INFINITY,
          delay: i * 0.2,
          ease: "easeInOut",
        }}
      />
    ))}
  </div>
);

const ButtonContent = ({
  isLoading,
  isFollowing,
}: {
  isLoading: boolean;
  isFollowing: boolean;
}) => (
  <AnimatePresence mode="wait">
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-center gap-2"
      exit={{ opacity: 0, y: -5 }}
      initial={{ opacity: 0, y: 5 }}
      key={(() => {
        if (isLoading) {
          return "loading";
        }
        if (isFollowing) {
          return "following";
        }
        return "follow";
      })()}
      transition={{ duration: 0.2 }}
    >
      {isLoading ? (
        <LoadingPulse />
      ) : (
        <>
          <span>{isFollowing ? "Following" : "Follow"}</span>
          {isFollowing ? (
            <motion.div
              animate={{ scale: 1 }}
              className="h-1.5 w-1.5 rounded-full bg-green-500"
              initial={{ scale: 0 }}
            />
          ) : null}
        </>
      )}
    </motion.div>
  </AnimatePresence>
);

const useFollowState = (userId: string, initialState: FollowerInfo) => {
  const [globalFollowState, setGlobalFollowState] = useAtom(followStateAtom);
  const [localState, setLocalState] = useState<FollowerInfo>(initialState);
  const queryClient = useQueryClient();

  useEffect(() => {
    const persistedState = globalFollowState[userId];
    if (persistedState && persistedState.lastUpdated > Date.now() - 300_000) {
      setLocalState({
        followers: persistedState.followers,
        isFollowedByUser: persistedState.isFollowing,
      });
    }
  }, [userId, globalFollowState]);

  const updateState = useCallback(
    (newState: FollowerInfo) => {
      setLocalState(newState);
      setGlobalFollowState((prev) => ({
        ...prev,
        [userId]: {
          isFollowing: newState.isFollowedByUser,
          followers: newState.followers,
          lastUpdated: Date.now(),
        },
      }));

      queryClient.invalidateQueries({ queryKey: ["follower-info", userId] });
      queryClient.invalidateQueries({ queryKey: ["suggested-connections"] });
      queryClient.invalidateQueries({ queryKey: ["trending-users"] });
      queryClient.invalidateQueries({ queryKey: ["user", userId] });
    },
    [userId, setGlobalFollowState, queryClient]
  );

  return [localState, updateState] as const;
};

const useFollowMutations = (userId: string, onFollowed?: () => void) => {
  const followMutation = useFollowUserMutation();
  const unfollowMutation = useUnfollowUserMutation();

  // Success/error feedback is handled by the shared mutations in
  // @/hooks/user-mutations, so no toasts are fired here.
  const handleFollow = async () => {
    const result = await followMutation.mutateAsync(userId);
    onFollowed?.();
    return result;
  };

  const handleUnfollow = async () => {
    const result = await unfollowMutation.mutateAsync(userId);
    return result;
  };

  return {
    handleFollow,
    handleUnfollow,
    isLoading: followMutation.isPending || unfollowMutation.isPending,
  };
};

const useOptimisticUpdate = (
  localState: FollowerInfo,
  updateState: (state: FollowerInfo) => void
) => {
  const performOptimisticUpdate = (isFollowing: boolean) => {
    const optimisticState = {
      followers: isFollowing
        ? localState.followers + 1
        : Math.max(localState.followers - 1, 0),
      isFollowedByUser: isFollowing,
    };
    updateState(optimisticState);
    return optimisticState;
  };

  const revertOptimisticUpdate = (previousState: FollowerInfo) => {
    updateState(previousState);
  };

  return { performOptimisticUpdate, revertOptimisticUpdate };
};

const ClientFollowButton: React.FC<ClientFollowButtonProps> = ({
  userId,
  initialState,
  className,
  onFollowed,
}) => {
  const [localState, updateState] = useFollowState(userId, initialState);
  const { handleFollow, handleUnfollow, isLoading } = useFollowMutations(
    userId,
    onFollowed
  );
  const { performOptimisticUpdate, revertOptimisticUpdate } =
    useOptimisticUpdate(localState, updateState);

  const handleFollowToggle = async () => {
    const previousState = { ...localState };
    const isFollowing = !localState.isFollowedByUser;

    try {
      performOptimisticUpdate(isFollowing);
      const result = isFollowing
        ? await handleFollow()
        : await handleUnfollow();
      updateState(result);
    } catch {
      revertOptimisticUpdate(previousState);
    }
  };

  debugLog.component("ClientFollowButton render:", {
    userId,
    localState,
    isLoading,
  });

  const isFollowing = localState.isFollowedByUser;

  return (
    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
      <Button
        className={cn(
          className,
          "relative overflow-hidden transition-all duration-300",
          {
            "bg-primary/90 hover:bg-primary": !isFollowing,
            "bg-secondary/80 hover:bg-secondary/90": isFollowing,
            "cursor-not-allowed": isLoading,
          }
        )}
        disabled={isLoading}
        onClick={handleFollowToggle}
        size="sm"
        variant={isFollowing ? "secondary" : "default"}
      >
        <ButtonContent isFollowing={isFollowing} isLoading={isLoading} />

        <AnimatePresence>
          {isLoading ? (
            <motion.div
              animate={{ x: "100%" }}
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
              exit={{ x: "100%" }}
              initial={{ x: "-100%" }}
              transition={{
                duration: 1,
                repeat: Number.POSITIVE_INFINITY,
                ease: "linear",
              }}
            />
          ) : null}
        </AnimatePresence>
      </Button>
    </motion.div>
  );
};

export default ClientFollowButton;
