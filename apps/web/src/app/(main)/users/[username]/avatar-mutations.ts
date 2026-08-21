import type { UpdateUserProfileValues } from "@asm/auth/validation";
import { clientLog } from "@asm/config/debug";
import type { PrivateUserData } from "@asm/db";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getSecureImageUrl } from "@/lib/utils/image-url";

interface UpdateProfilePayload {
  userId: string;
  values: UpdateUserProfileValues;
}

interface UpdateAvatarPayload {
  file: File;
  oldAvatarKey?: string;
  userId: string;
}

interface UpdateBannerPayload {
  file: File;
  oldBannerKey?: string;
  userId: string;
}

interface UpdateAvatarResponse {
  avatar: {
    key: string;
    url: string;
  };
}

interface UpdateBannerResponse {
  banner: {
    key: string;
    url: string;
  };
}

interface AvatarMutationContext {
  previousAvatar: unknown;
  previousUser: PrivateUserData | undefined;
}

interface BannerMutationContext {
  optimisticUrl: string;
  previousUser: PrivateUserData | undefined;
}

interface ProfileMutationContext {
  previousUser: PrivateUserData | undefined;
}

interface UpdateProfileResponse {
  user: {
    avatarKey: string | null;
    avatarUrl: string | null;
    bio: string | null;
    displayName: string;
    githubUsername: string | null;
    linkedinUsername: string | null;
    twitterUsername: string | null;
    redditUsername: string | null;
  };
}

export function useUpdateAvatarMutation() {
  const queryClient = useQueryClient();

  return useMutation<
    UpdateAvatarResponse,
    Error,
    UpdateAvatarPayload,
    AvatarMutationContext
  >({
    mutationFn: async ({ file, userId, oldAvatarKey }: UpdateAvatarPayload) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("userId", userId);
      if (oldAvatarKey) {
        formData.append("oldAvatarKey", oldAvatarKey);
      }

      const response = await fetch("/api/users/avatar", {
        body: formData,
        method: "POST",
      });

      if (!response.ok) {
        throw new Error((await response.text()) || "Failed to update avatar");
      }

      const data = (await response.json()) as UpdateAvatarResponse;
      return data;
    },
    onError: (error, _, context) => {
      clientLog.error("Avatar update error:", error);
      if (context?.previousUser) {
        queryClient.setQueryData(
          ["user", context.previousUser.id],
          context.previousUser
        );
      }
      if (context?.previousAvatar) {
        queryClient.setQueryData(
          ["avatar", context.previousUser?.id],
          context.previousAvatar
        );
      }
    },
    onMutate: async ({ file, userId }) => {
      await queryClient.cancelQueries({ queryKey: ["user", userId] });
      await queryClient.cancelQueries({ queryKey: ["avatar", userId] });

      const previousUser = queryClient.getQueryData<PrivateUserData>([
        "user",
        userId,
      ]);
      const previousAvatar = queryClient.getQueryData(["avatar", userId]);
      const optimisticUrl = URL.createObjectURL(file);

      queryClient.setQueryData<PrivateUserData>(["user", userId], (old) =>
        old ? { ...old, avatarUrl: optimisticUrl } : old
      );

      queryClient.setQueryData(["avatar", userId], {
        key: null,
        url: optimisticUrl,
      });

      return { previousAvatar, previousUser };
    },
    onSuccess: (data, { userId }) => {
      const secureUrl = getSecureImageUrl(data.avatar.url);

      queryClient.setQueryData<PrivateUserData>(["user", userId], (old) =>
        old ? { ...old, avatarKey: data.avatar.key, avatarUrl: secureUrl } : old
      );

      queryClient.setQueryData(["avatar", userId], {
        key: data.avatar.key,
        url: secureUrl,
      });

      queryClient.invalidateQueries({ queryKey: ["post-feed"] });
    },
  });
}

export function useUpdateBannerMutation() {
  const queryClient = useQueryClient();

  return useMutation<
    UpdateBannerResponse,
    Error,
    UpdateBannerPayload,
    BannerMutationContext
  >({
    mutationFn: async ({ file, userId, oldBannerKey }: UpdateBannerPayload) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("userId", userId);
      if (oldBannerKey) {
        formData.append("oldBannerKey", oldBannerKey);
      }

      const response = await fetch("/api/users/banner", {
        body: formData,
        method: "POST",
      });

      if (!response.ok) {
        throw new Error((await response.text()) || "Failed to update banner");
      }

      const data = (await response.json()) as UpdateBannerResponse;
      return data;
    },
    onError: (error, _, context) => {
      clientLog.error("Banner update error:", error);
      if (context?.previousUser) {
        queryClient.setQueryData(
          ["user", context.previousUser.id],
          context.previousUser
        );
      }
    },
    onMutate: async ({ file, userId }) => {
      await queryClient.cancelQueries({ queryKey: ["user", userId] });

      const previousUser = queryClient.getQueryData<PrivateUserData>([
        "user",
        userId,
      ]);
      const optimisticUrl = URL.createObjectURL(file);

      queryClient.setQueryData<PrivateUserData>(["user", userId], (old) =>
        old ? { ...old, bannerUrl: optimisticUrl } : old
      );

      return { optimisticUrl, previousUser };
    },
    onSettled: (_, __, ___, context) => {
      if (context?.optimisticUrl) {
        URL.revokeObjectURL(context.optimisticUrl);
      }
    },
    onSuccess: (data, { userId }) => {
      const secureUrl = getSecureImageUrl(data.banner.url);

      queryClient.setQueryData<PrivateUserData>(["user", userId], (old) =>
        old ? { ...old, bannerKey: data.banner.key, bannerUrl: secureUrl } : old
      );

      queryClient.invalidateQueries({ queryKey: ["post-feed"] });
    },
  });
}

export function useDeleteBannerMutation() {
  const queryClient = useQueryClient();

  return useMutation<
    // oxlint-disable-next-line typescript/no-invalid-void-type -- delete mutations carry no data
    void,
    Error,
    { bannerKey: string; userId: string },
    ProfileMutationContext
  >({
    mutationFn: async ({
      bannerKey,
      userId,
    }: {
      bannerKey: string;
      userId: string;
    }) => {
      const response = await fetch("/api/users/banner", {
        body: JSON.stringify({ bannerKey, userId }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error((await response.text()) || "Failed to remove banner");
      }
    },
    onError: (error, _, context) => {
      clientLog.error("Banner delete error:", error);
      if (context?.previousUser) {
        queryClient.setQueryData(
          ["user", context.previousUser.id],
          context.previousUser
        );
      }
    },
    onMutate: async ({ userId }) => {
      await queryClient.cancelQueries({ queryKey: ["user", userId] });
      const previousUser = queryClient.getQueryData<PrivateUserData>([
        "user",
        userId,
      ]);

      queryClient.setQueryData<PrivateUserData>(["user", userId], (old) =>
        old ? { ...old, bannerKey: null, bannerUrl: null } : old
      );

      return { previousUser };
    },
  });
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation<
    UpdateProfileResponse["user"],
    Error,
    UpdateProfilePayload,
    ProfileMutationContext
  >({
    mutationFn: async ({ values, userId }: UpdateProfilePayload) => {
      try {
        const formData = new FormData();
        formData.append("values", JSON.stringify(values));
        formData.append("userId", userId);

        const response = await fetch("/api/users/profile", {
          body: formData,
          method: "POST",
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(error || "Failed to update profile");
        }

        const data = (await response.json()) as UpdateProfileResponse;
        return data.user;
      } catch (error) {
        clientLog.error("Profile update error:", error);
        throw error;
      }
    },
    onError: (error, _, context) => {
      clientLog.error("Profile update error:", error);
      if (context?.previousUser) {
        queryClient.setQueryData(
          ["user", context.previousUser.id],
          context.previousUser
        );
      }
    },
    onMutate: async ({ values, userId }) => {
      await queryClient.cancelQueries({ queryKey: ["user", userId] });
      const previousUser = queryClient.getQueryData<PrivateUserData>([
        "user",
        userId,
      ]);

      if (previousUser) {
        const optimisticUser = {
          ...previousUser,
          bio: values.bio,
          displayName: values.displayName,
          githubUsername: values.githubUsername ?? null,
          linkedinUsername: values.linkedinUsername ?? null,
          redditUsername: values.redditUsername ?? null,
          twitterUsername: values.twitterUsername ?? null,
        };
        queryClient.setQueryData(["user", userId], optimisticUser);
      }

      return { previousUser };
    },
    onSuccess: (updatedUser, { userId }) => {
      queryClient.setQueryData<PrivateUserData>(["user", userId], (old) =>
        old
          ? {
              ...old,
              // Profile updates never change the avatar; keep the cached key
              // (avatar uploads update it via their own mutation).
              avatarKey: old.avatarKey,
              avatarUrl: updatedUser.avatarUrl ?? old.avatarUrl,
              bio: updatedUser.bio ?? "",
              displayName: updatedUser.displayName,
              githubUsername: updatedUser.githubUsername,
              linkedinUsername: updatedUser.linkedinUsername,
              redditUsername: updatedUser.redditUsername,
              twitterUsername: updatedUser.twitterUsername,
            }
          : old
      );

      queryClient.invalidateQueries({ queryKey: ["post-feed"] });
      queryClient.invalidateQueries({ queryKey: ["comments"] });
    },
  });
}
