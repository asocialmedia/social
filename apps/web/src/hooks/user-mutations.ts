import { debugLog } from "@asm/config/debug";
import type { FollowerInfo, UserData } from "@asm/db";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserMinus, UserPlus } from "lucide-react";
import { createElement } from "react";

import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";

const QUERY_KEYS = {
  followerInfo: (userId: string) => ["follower-info", userId],
  suggestedUsers: ["suggested-users"],
  user: (userId: string) => ["user", userId],
  userProfile: (userId: string) => ["user-profile", userId],
} as const;

interface MutationContext {
  previousData: {
    followerInfo: FollowerInfo | undefined;
    suggestedUsers: UserData[] | undefined;
    user: UserData | undefined;
    userProfile: unknown;
  };
}

interface FollowResponseData extends FollowerInfo {
  displayName: string;
  username: string;
}

async function followUser(userId: string): Promise<FollowResponseData> {
  try {
    const response = await kyInstance
      .post(`/api/users/${userId}/followers`)
      .json<FollowResponseData>();
    debugLog.mutation("Follow API response:", response);
    return response;
  } catch (error) {
    debugLog.mutation("Follow API error:", error);
    throw error;
  }
}

async function unfollowUser(userId: string): Promise<FollowResponseData> {
  try {
    const response = await kyInstance
      .delete(`/api/users/${userId}/followers`)
      .json<FollowResponseData>();
    debugLog.mutation("Unfollow API response:", response);
    return response;
  } catch (error) {
    debugLog.mutation("Unfollow API error:", error);
    throw error;
  }
}

export function useFollowUserMutation() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation<FollowResponseData, Error, string, MutationContext>({
    mutationFn: followUser,

    onError: (error, userId, context) => {
      debugLog.mutation("Follow mutation error:", error);
      if (context?.previousData) {
        // Revert all optimistic updates
        queryClient.setQueryData(
          QUERY_KEYS.followerInfo(userId),
          context.previousData.followerInfo
        );
        queryClient.setQueryData(
          QUERY_KEYS.suggestedUsers,
          context.previousData.suggestedUsers
        );
        queryClient.setQueryData(
          QUERY_KEYS.user(userId),
          context.previousData.user
        );
        queryClient.setQueryData(
          QUERY_KEYS.userProfile(userId),
          context.previousData.userProfile
        );
      }

      toast({
        description: "Couldn't follow that person, give it another try?",
        variant: "destructive",
      });
    },

    onMutate: async (userId): Promise<MutationContext> => {
      debugLog.mutation("Starting follow mutation for user:", userId);

      // Cancel any outgoing refetches
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: QUERY_KEYS.followerInfo(userId),
        }),
        queryClient.cancelQueries({ queryKey: QUERY_KEYS.suggestedUsers }),
        queryClient.cancelQueries({ queryKey: QUERY_KEYS.user(userId) }),
        queryClient.cancelQueries({ queryKey: QUERY_KEYS.userProfile(userId) }),
      ]);

      // Snapshot current values
      const previousData = {
        followerInfo: queryClient.getQueryData<FollowerInfo>(
          QUERY_KEYS.followerInfo(userId)
        ),
        suggestedUsers: queryClient.getQueryData<UserData[]>(
          QUERY_KEYS.suggestedUsers
        ),
        user: queryClient.getQueryData<UserData>(QUERY_KEYS.user(userId)),
        userProfile: queryClient.getQueryData(QUERY_KEYS.userProfile(userId)),
      };

      debugLog.mutation("Previous data snapshot:", previousData);

      // Optimistically update the follow state
      queryClient.setQueryData<FollowerInfo>(
        QUERY_KEYS.followerInfo(userId),
        (old) => {
          const newData = {
            followers: (old?.followers || 0) + 1,
            isFollowedByUser: true,
          };
          debugLog.mutation("Optimistic update:", newData);
          return newData;
        }
      );

      // Remove from suggested users if present
      queryClient.setQueryData<UserData[]>(
        QUERY_KEYS.suggestedUsers,
        (old) => old?.filter((user) => user.id !== userId) ?? []
      );

      return { previousData };
    },

    onSettled: async (_, __, userId) => {
      debugLog.mutation("Follow mutation settled, invalidating queries");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.followerInfo(userId),
        }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.suggestedUsers }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.user(userId) }),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.userProfile(userId),
        }),
      ]);
    },

    onSuccess: (data, userId) => {
      debugLog.mutation("Follow mutation succeeded:", { data, userId });
      queryClient.setQueryData(QUERY_KEYS.followerInfo(userId), data);

      toast({
        description: `You're now following ${data.displayName || "this user"}`,
        icon: createElement(UserPlus),
        title: "Followed",
      });
    },

    retry: 2,
  });
}

export function useUnfollowUserMutation() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation<FollowResponseData, Error, string, MutationContext>({
    mutationFn: unfollowUser,

    onError: (error, userId, context) => {
      debugLog.mutation("Unfollow mutation error:", error);
      if (context?.previousData) {
        // Revert all optimistic updates
        if (context.previousData.followerInfo) {
          queryClient.setQueryData(
            QUERY_KEYS.followerInfo(userId),
            context.previousData.followerInfo
          );
        }
        if (context.previousData.suggestedUsers) {
          queryClient.setQueryData(
            QUERY_KEYS.suggestedUsers,
            context.previousData.suggestedUsers
          );
        }
        if (context.previousData.user) {
          queryClient.setQueryData(
            QUERY_KEYS.user(userId),
            context.previousData.user
          );
        }
        queryClient.setQueryData(
          QUERY_KEYS.userProfile(userId),
          context.previousData.userProfile
        );
      }

      toast({
        description: "Couldn't unfollow, give it another try?",
        variant: "destructive",
      });
    },

    onMutate: async (userId): Promise<MutationContext> => {
      debugLog.mutation("Starting unfollow mutation for user:", userId);

      // Cancel any outgoing refetches
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: QUERY_KEYS.followerInfo(userId),
        }),
        queryClient.cancelQueries({ queryKey: QUERY_KEYS.suggestedUsers }),
        queryClient.cancelQueries({ queryKey: QUERY_KEYS.user(userId) }),
        queryClient.cancelQueries({ queryKey: QUERY_KEYS.userProfile(userId) }),
      ]);

      // Snapshot the previous values
      const previousData = {
        followerInfo: queryClient.getQueryData<FollowerInfo>(
          QUERY_KEYS.followerInfo(userId)
        ),
        suggestedUsers: queryClient.getQueryData<UserData[]>(
          QUERY_KEYS.suggestedUsers
        ),
        user: queryClient.getQueryData<UserData>(QUERY_KEYS.user(userId)),
        userProfile: queryClient.getQueryData(QUERY_KEYS.userProfile(userId)),
      };

      debugLog.mutation("Previous data snapshot:", previousData);

      // Optimistically update
      const currentFollowerInfo = previousData.followerInfo;
      if (currentFollowerInfo) {
        queryClient.setQueryData<FollowerInfo>(
          QUERY_KEYS.followerInfo(userId),
          {
            followers: Math.max(currentFollowerInfo.followers - 1, 0),
            isFollowedByUser: false,
          }
        );
      }

      return { previousData };
    },

    onSettled: async (data, error, userId) => {
      debugLog.mutation("Unfollow mutation settled:", { data, error });

      // Always refetch to ensure consistency
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.followerInfo(userId),
        }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.suggestedUsers }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.user(userId) }),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.userProfile(userId),
        }),
      ]);
    },

    onSuccess: (data, userId) => {
      debugLog.mutation("Unfollow mutation succeeded:", { data, userId });

      if (data) {
        queryClient.setQueryData<FollowerInfo>(
          QUERY_KEYS.followerInfo(userId),
          {
            followers: data.followers,
            isFollowedByUser: false,
          }
        );

        toast({
          description: `You've unfollowed ${data.displayName || "this user"}, you can follow them again anytime`,
          icon: createElement(UserMinus),
          title: "Unfollowed",
        });
      }
    },

    retry: 2,
  });
}
