import type { UpdateUserProfileValues } from "@asm/auth/validation";
import type { UserData } from "@asm/db";
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

interface UpdateAvatarResponse {
  avatar: {
    key: string;
    url: string;
  };
}

interface UpdateProfileResponse {
  user: {
    avatarKey: string | null;
    avatarUrl: string | null;
    bio: string | null;
    displayName: string;
  };
}

export function useUpdateAvatarMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ file, userId, oldAvatarKey }: UpdateAvatarPayload) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("userId", userId);
      if (oldAvatarKey) {
        formData.append("oldAvatarKey", oldAvatarKey);
      }

      const response = await fetch("/api/users/avatar", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error((await response.text()) || "Failed to update avatar");
      }

      const data = (await response.json()) as UpdateAvatarResponse;
      return data;
    },
    onMutate: async ({ file, userId }) => {
      await queryClient.cancelQueries({ queryKey: ["user", userId] });
      await queryClient.cancelQueries({ queryKey: ["avatar", userId] });

      const previousUser = queryClient.getQueryData<UserData>(["user", userId]);
      const previousAvatar = queryClient.getQueryData(["avatar", userId]);
      const optimisticUrl = URL.createObjectURL(file);

      queryClient.setQueryData<UserData>(["user", userId], (old) =>
        old ? { ...old, avatarUrl: optimisticUrl } : old
      );

      queryClient.setQueryData(["avatar", userId], {
        url: optimisticUrl,
        key: null,
      });

      return { previousUser, previousAvatar };
    },
    onSuccess: (data, { userId }) => {
      const secureUrl = getSecureImageUrl(data.avatar.url);

      queryClient.setQueryData<UserData>(["user", userId], (old) =>
        old ? { ...old, avatarKey: data.avatar.key, avatarUrl: secureUrl } : old
      );

      queryClient.setQueryData(["avatar", userId], {
        url: secureUrl,
        key: data.avatar.key,
      });

      queryClient.invalidateQueries({ queryKey: ["post-feed"] });
    },
    onError: (error, _, context) => {
      console.error("Avatar update error:", error);
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
  });
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ values, userId }: UpdateProfilePayload) => {
      try {
        const formData = new FormData();
        formData.append("values", JSON.stringify(values));
        formData.append("userId", userId);

        const response = await fetch("/api/users/profile", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(error || "Failed to update profile");
        }

        const data = (await response.json()) as UpdateProfileResponse;
        return data.user;
      } catch (error) {
        console.error("Profile update error:", error);
        throw error;
      }
    },
    onMutate: async ({ values, userId }) => {
      await queryClient.cancelQueries({ queryKey: ["user", userId] });
      const previousUser = queryClient.getQueryData<UserData>(["user", userId]);

      if (previousUser) {
        const optimisticUser = {
          ...previousUser,
          displayName: values.displayName,
          bio: values.bio,
        };
        queryClient.setQueryData(["user", userId], optimisticUser);
      }

      return { previousUser };
    },
    onSuccess: (updatedUser, { userId }) => {
      queryClient.setQueryData<UserData>(["user", userId], (old) =>
        old
          ? {
              ...old,
              displayName: updatedUser.displayName,
              bio: updatedUser.bio ?? "",
              avatarUrl: updatedUser.avatarUrl ?? old.avatarUrl,
              avatarKey: updatedUser.avatarKey ?? old.avatarKey,
            }
          : old
      );

      queryClient.invalidateQueries({ queryKey: ["post-feed"] });
      queryClient.invalidateQueries({ queryKey: ["comments"] });
    },
    onError: (error, _, context) => {
      console.error("Profile update error:", error);
      if (context?.previousUser) {
        queryClient.setQueryData(
          ["user", context.previousUser.id],
          context.previousUser
        );
      }
    },
  });
}
