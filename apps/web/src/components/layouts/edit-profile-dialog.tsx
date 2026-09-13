import { updateUserProfileSchema } from "@asm/auth/validation";
import type { UpdateUserProfileValues } from "@asm/auth/validation";
import { clientLog } from "@asm/config/debug";
import type { PrivateUserData } from "@asm/db";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@asm/ui/shadui/form";
import { Input } from "@asm/ui/shadui/input";
import { Label } from "@asm/ui/shadui/label";
import { Textarea } from "@asm/ui/shadui/textarea";
import avatarPlaceholder from "@assets/general/avatar-placeholder.png";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { Control, ControllerRenderProps } from "react-hook-form";

import {
  useDeleteAvatarMutation,
  useDeleteBannerMutation,
  useUpdateAvatarMutation,
  useUpdateBannerMutation,
  useUpdateProfileMutation,
} from "@/app/(main)/users/[username]/avatar-mutations";
import { LoadingButton } from "@/components/auth/loading-button";
import { AnimatedWordCounter } from "@/components/misc/animated-word-counter";
import {
  AvatarInput,
  BannerInput,
} from "@/components/profile/profile-media-inputs";
import { useToast } from "@/lib/gooey-toast";
import type { UploadStage } from "@/lib/media/media-upload-client";
import { cn } from "@/lib/utils";

const ORANGE_GRADIENT_CLASS =
  "bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

interface EditProfileDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  user: PrivateUserData;
}

const regex = /\s+/;

// Pre-pick cache values remembered while the pick-time optimistic avatar
// preview is live, so a cancel restores exactly what was there before.
interface AvatarPreviewRestore {
  avatar: { key: string | null; url: string } | undefined;
  avatarUrl: string | null;
}

interface BannerPreviewRestore {
  bannerUrl: string | null;
}

type SocialFieldName =
  | "customDomain"
  | "githubUsername"
  | "linkedinUsername"
  | "twitterUsername"
  | "redditUsername";

interface SocialFieldConfig {
  label: string;
  name: SocialFieldName;
  placeholder: string;
}

const SOCIAL_FIELDS: SocialFieldConfig[] = [
  {
    label: "GitHub",
    name: "githubUsername",
    placeholder: "octocat",
  },
  {
    label: "LinkedIn",
    name: "linkedinUsername",
    placeholder: "john-doe",
  },
  {
    label: "Twitter / X",
    name: "twitterUsername",
    placeholder: "yourhandle",
  },
  {
    label: "Reddit",
    name: "redditUsername",
    placeholder: "yourusername",
  },
  {
    label: "Custom domain",
    name: "customDomain",
    placeholder: "yourdomain.com",
  },
];

export default function EditProfileDialog({
  user,
  open,
  onOpenChange,
}: EditProfileDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const form = useForm<UpdateUserProfileValues>({
    defaultValues: {
      bio: user.bio || "",
      customDomain: user.customDomain ?? "",
      displayName: user.displayName,
      githubUsername: user.githubUsername ?? "",
      linkedinUsername: user.linkedinUsername ?? "",
      redditUsername: user.redditUsername ?? "",
      twitterUsername: user.twitterUsername ?? "",
    },
    resolver: zodResolver(updateUserProfileSchema),
  });

  const [croppedAvatar, setCroppedAvatar] = useState<Blob | null>(null);
  const [gifToCenter, setGifToCenter] = useState<File | null>(null);
  const [croppedBanner, setCroppedBanner] = useState<Blob | null>(null);
  const [bannerGif, setBannerGif] = useState<File | null>(null);
  const [bannerRemoved, setBannerRemoved] = useState(false);
  const [avatarDeleted, setAvatarDeleted] = useState(false);
  // Pipeline feedback for 3D spinner: real stages from uploadMediaFile
  const [avatarStage, setAvatarStage] = useState<UploadStage | null>(null);
  const [avatarProgress, setAvatarProgress] = useState(0);
  const [bannerStage, setBannerStage] = useState<UploadStage | null>(null);
  const [bannerProgress, setBannerProgress] = useState(0);
  // Mirrors the last seen open/user pair so closing the dialog (or fresh
  // profile data arriving behind it) clears transient editor state during
  // render instead of from a cascading effect.
  const [resetInputs, setResetInputs] = useState<{
    open: boolean;
    user: PrivateUserData;
  } | null>(null);
  const avatarMutation = useUpdateAvatarMutation();
  const bannerMutation = useUpdateBannerMutation();
  const deleteBannerMutation = useDeleteBannerMutation();
  const deleteAvatarMutation = useDeleteAvatarMutation();
  const profileMutation = useUpdateProfileMutation();
  const isUpdating =
    avatarMutation.isPending ||
    bannerMutation.isPending ||
    profileMutation.isPending ||
    deleteBannerMutation.isPending ||
    deleteAvatarMutation.isPending;

  if (
    resetInputs === null ||
    resetInputs.open !== open ||
    resetInputs.user !== user
  ) {
    setResetInputs({ open, user });
    if (!open) {
      setCroppedAvatar(null);
      setGifToCenter(null);
      setCroppedBanner(null);
      setBannerGif(null);
      setBannerRemoved(false);
      setAvatarDeleted(false);
      setAvatarStage(null);
      setAvatarProgress(0);
      setBannerStage(null);
      setBannerProgress(0);
    }
  }

  // Keep a stable object URL for the cropped preview and revoke it on change/unmount.
  const croppedAvatarUrl = useMemo(
    () => (croppedAvatar ? URL.createObjectURL(croppedAvatar) : null),
    [croppedAvatar]
  );

  const croppedBannerUrl = useMemo(
    () => (croppedBanner ? URL.createObjectURL(croppedBanner) : null),
    [croppedBanner]
  );

  useEffect(
    () => () => {
      if (croppedAvatarUrl) {
        URL.revokeObjectURL(croppedAvatarUrl);
      }
      if (croppedBannerUrl) {
        URL.revokeObjectURL(croppedBannerUrl);
      }
    },
    [croppedAvatarUrl, croppedBannerUrl]
  );

  // Pick-time optimistic preview: the moment a cropped avatar lands, the
  // navbar/profile avatars show it - no need to hit Save first. Remembers
  // the pre-pick cache values so a cancel (closing without saving, or
  // clearing the pick) restores exactly what was there. A completed upload
  // replaces the preview with the real URL, which the restore guard detects
  // and skips.
  const avatarPreviewRestoreRef = useRef<AvatarPreviewRestore | null>(null);
  const avatarPreviewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (croppedAvatarUrl) {
      if (avatarPreviewRestoreRef.current === null) {
        const cachedUser = queryClient.getQueryData<{
          avatarUrl?: string | null;
        }>(["user", user.id]);
        avatarPreviewRestoreRef.current = {
          avatar: queryClient.getQueryData<{ key: string | null; url: string }>(
            ["avatar", user.id]
          ),
          avatarUrl: cachedUser?.avatarUrl ?? user.avatarUrl ?? null,
        };
      }
      avatarPreviewUrlRef.current = croppedAvatarUrl;
      queryClient.setQueryData<PrivateUserData>(["user", user.id], (old) =>
        old ? { ...old, avatarUrl: croppedAvatarUrl } : old
      );
      queryClient.setQueryData(["avatar", user.id], {
        key: null,
        url: croppedAvatarUrl,
      });
    } else if (avatarPreviewRestoreRef.current !== null) {
      const cachedUser = queryClient.getQueryData<{
        avatarUrl?: string | null;
      }>(["user", user.id]);
      if (cachedUser?.avatarUrl === avatarPreviewUrlRef.current) {
        const restore = avatarPreviewRestoreRef.current;
        queryClient.setQueryData<PrivateUserData>(["user", user.id], (old) =>
          old ? { ...old, avatarUrl: restore.avatarUrl } : old
        );
        if (restore.avatar !== undefined) {
          queryClient.setQueryData(["avatar", user.id], restore.avatar);
        }
      }
      avatarPreviewRestoreRef.current = null;
      avatarPreviewUrlRef.current = null;
    }
  }, [croppedAvatarUrl, queryClient, user.avatarUrl, user.id]);

  // Banner pick-time optimistic preview: same instant feedback as avatar,
  // so header updates everywhere before Save, and cancel restores.
  const bannerPreviewRestoreRef = useRef<BannerPreviewRestore | null>(null);
  const bannerPreviewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (croppedBannerUrl) {
      if (bannerPreviewRestoreRef.current === null) {
        const cachedUser = queryClient.getQueryData<{
          bannerUrl?: string | null;
        }>(["user", user.id]);
        bannerPreviewRestoreRef.current = {
          bannerUrl: cachedUser?.bannerUrl ?? user.bannerUrl ?? null,
        };
      }
      bannerPreviewUrlRef.current = croppedBannerUrl;
      queryClient.setQueryData<PrivateUserData>(["user", user.id], (old) =>
        old ? { ...old, bannerUrl: croppedBannerUrl } : old
      );
    } else if (bannerPreviewRestoreRef.current !== null) {
      const cachedUser = queryClient.getQueryData<{
        bannerUrl?: string | null;
      }>(["user", user.id]);
      if (cachedUser?.bannerUrl === bannerPreviewUrlRef.current) {
        const restore = bannerPreviewRestoreRef.current;
        queryClient.setQueryData<PrivateUserData>(["user", user.id], (old) =>
          old ? { ...old, bannerUrl: restore.bannerUrl } : old
        );
      }
      bannerPreviewRestoreRef.current = null;
      bannerPreviewUrlRef.current = null;
    }
  }, [croppedBannerUrl, queryClient, user.bannerUrl, user.id]);

  // The form lives in react-hook-form's own store shared with the field
  // components below, so its reset must stay imperative (post-render) rather
  // than running during this component's render.
  useEffect(() => {
    if (!open) {
      form.reset({
        bio: user.bio || "",
        customDomain: user.customDomain ?? "",
        displayName: user.displayName,
        githubUsername: user.githubUsername ?? "",
        linkedinUsername: user.linkedinUsername ?? "",
        redditUsername: user.redditUsername ?? "",
        twitterUsername: user.twitterUsername ?? "",
      });
    }
  }, [open, user, form]);

  const checkForChanges = (values: UpdateUserProfileValues) => {
    const hasProfileChanges =
      values.displayName !== user.displayName ||
      values.bio !== user.bio ||
      values.customDomain !== (user.customDomain ?? "") ||
      values.githubUsername !== (user.githubUsername ?? "") ||
      values.linkedinUsername !== (user.linkedinUsername ?? "") ||
      values.twitterUsername !== (user.twitterUsername ?? "") ||
      values.redditUsername !== (user.redditUsername ?? "");
    const hasAvatarChanges = Boolean(croppedAvatar || gifToCenter);
    const hasAvatarDeleted =
      avatarDeleted && Boolean(user.avatarUrl || user.avatarKey);
    const hasBannerChanges =
      Boolean(croppedBanner || bannerGif) ||
      (bannerRemoved && Boolean(user.bannerUrl || user.bannerKey));
    return {
      hasAvatarChanges,
      hasAvatarDeleted,
      hasBannerChanges,
      hasProfileChanges,
    };
  };

  const updateProfile = async (values: UpdateUserProfileValues) => {
    await profileMutation.mutateAsync({
      userId: user.id,
      values,
    });
  };

  const updateAvatar = async () => {
    const file = croppedAvatar
      ? new File([croppedAvatar], `avatar_${user.id}.webp`, {
          type: "image/webp",
        })
      : gifToCenter;

    if (file) {
      setAvatarStage("uploading");
      setAvatarProgress(0);
      try {
        await avatarMutation.mutateAsync({
          file,
          onProgress: setAvatarProgress,
          onStage: setAvatarStage,
          userId: user.id,
        });
        setAvatarStage(null);
        setAvatarProgress(0);
      } catch (error) {
        setAvatarStage(null);
        setAvatarProgress(0);
        throw error;
      }
    }
  };

  const updateBanner = async () => {
    // GIF banners skip cropping (resizing flattens animation); the centering
    // dialog normally uploads them, but a pending gif here still uploads.
    if (bannerGif) {
      setBannerStage("uploading");
      setBannerProgress(0);
      try {
        await bannerMutation.mutateAsync({
          file: bannerGif,
          onProgress: setBannerProgress,
          onStage: setBannerStage,
          userId: user.id,
        });
        setBannerStage(null);
        setBannerProgress(0);
      } catch (error) {
        setBannerStage(null);
        setBannerProgress(0);
        throw error;
      }
      return;
    }
    if (croppedBanner) {
      const file = new File([croppedBanner], `banner_${user.id}.webp`, {
        type: "image/webp",
      });
      setBannerStage("uploading");
      setBannerProgress(0);
      try {
        await bannerMutation.mutateAsync({
          file,
          onProgress: setBannerProgress,
          onStage: setBannerStage,
          userId: user.id,
        });
        setBannerStage(null);
        setBannerProgress(0);
      } catch (error) {
        setBannerStage(null);
        setBannerProgress(0);
        throw error;
      }
      return;
    }
    if (bannerRemoved && (user.bannerUrl || user.bannerKey)) {
      await deleteBannerMutation.mutateAsync({
        bannerKey: user.bannerKey ?? "",
        userId: user.id,
      });
    }
  };

  const handleSubmit = async (values: UpdateUserProfileValues) => {
    try {
      const {
        hasAvatarChanges,
        hasAvatarDeleted,
        hasBannerChanges,
        hasProfileChanges,
      } = checkForChanges(values);

      if (
        !(
          hasProfileChanges ||
          hasAvatarChanges ||
          hasAvatarDeleted ||
          hasBannerChanges
        )
      ) {
        toast({
          description: "Looks like nothing changed, make a tweak and save!",
          title: "No Changes",
        });
        return;
      }

      if (hasProfileChanges) {
        await updateProfile(values);
      }

      if (hasAvatarChanges) {
        await updateAvatar();
      } else if (hasAvatarDeleted) {
        await deleteAvatarMutation.mutateAsync({ userId: user.id });
      }

      if (hasBannerChanges) {
        await updateBanner();
      }

      onOpenChange(false);
      toast({
        description: "Your profile is looking fresh!",
        title: "Profile Updated",
      });
    } catch (error) {
      clientLog.error("Failed to update profile:", error);
      toast({
        description: "Couldn't save your changes, try again?",
        title: "Couldn't Save",
        variant: "destructive",
      });
    }
  };

  const renderDisplayNameField = useCallback(
    ({
      field,
    }: {
      field: ControllerRenderProps<UpdateUserProfileValues, "displayName">;
    }) => (
      <FormItem>
        <FormLabel>Display name</FormLabel>
        <FormControl>
          <Input
            className="h-10 rounded-xl text-sm"
            placeholder="Your display name"
            {...field}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    ),
    []
  );

  const renderBioField = useCallback(
    ({
      field,
    }: {
      field: ControllerRenderProps<UpdateUserProfileValues, "bio">;
    }) => (
      <FormItem>
        <FormLabel>Bio</FormLabel>
        <FormControl>
          <div className="space-y-1">
            <Textarea
              className="premium-input resize-none rounded-xl text-sm"
              placeholder="Tell us a little bit about yourself"
              rows={4}
              {...field}
            />
            <div className="flex justify-end">
              <AnimatedWordCounter
                current={field.value.trim().split(regex).filter(Boolean).length}
                max={400}
              />
            </div>
          </div>
        </FormControl>
        <FormMessage />
      </FormItem>
    ),
    []
  );

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleRemoveBanner = useCallback(() => {
    setBannerRemoved(true);
    setCroppedBanner(null);
  }, []);

  const handleDeleteAvatar = useCallback(() => {
    setCroppedAvatar(null);
    setGifToCenter(null);
    setAvatarDeleted(true);
  }, []);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="apple-panel flex max-h-[75dvh] w-[calc(100%-1.5rem)] max-w-120 flex-col gap-4 overflow-hidden rounded-2xl border-0 p-0 md:max-h-[85vh] [&>button:last-child]:hidden"
        onClick={handleContentClick}
      >
        {/* Flush square avatar fills the header's left edge; title and
            description sit to its right, with a 3D close button centered
            against the header row. */}
        <div className="border-border/60 flex shrink-0 items-center border-b py-2 pr-3 pl-3">
          <div className="relative size-10 shrink-0">
            <Image
              alt=""
              className="object-cover"
              fill
              sizes="40px"
              src={avatarPlaceholder}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center px-4 py-2">
            <DialogTitle className="text-base font-semibold">
              Edit Profile
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-0.5 text-xs">
              Update your profile details
            </DialogDescription>
          </div>
          <DialogClose
            className="icon-btn-3d flex size-7 shrink-0 items-center justify-center rounded-full border-0"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <div className="space-y-1.5">
            <Label>Header image</Label>
            <BannerInput
              canRemove={Boolean(user.bannerUrl || user.bannerKey)}
              isRemoved={bannerRemoved}
              isUploading={bannerMutation.isPending}
              onBannerCropped={setCroppedBanner}
              onGifSelected={setBannerGif}
              onRemove={handleRemoveBanner}
              progress={bannerProgress}
              stage={bannerStage}
              src={
                croppedBannerUrl ??
                (bannerRemoved ? "" : (user.bannerUrl ?? ""))
              }
              user={user}
            />
          </div>

          <div className="mt-4 space-y-1.5">
            <Label>Avatar</Label>
            <AvatarInput
              canDelete={Boolean(user.avatarUrl || user.avatarKey)}
              isDeleted={avatarDeleted}
              isUploading={avatarMutation.isPending}
              onDelete={handleDeleteAvatar}
              onGifSelected={setGifToCenter}
              onImageCropped={setCroppedAvatar}
              progress={avatarProgress}
              stage={avatarStage}
              src={
                avatarDeleted
                  ? avatarPlaceholder.src
                  : (croppedAvatarUrl ??
                    user.avatarUrl ??
                    avatarPlaceholder.src)
              }
              user={user}
            />
          </div>

          <div className="mt-4">
            <Form {...form}>
              <form
                className="space-y-3"
                onSubmit={form.handleSubmit(handleSubmit)}
              >
                <FormField
                  control={form.control}
                  name="displayName"
                  render={renderDisplayNameField}
                />
                <FormField
                  control={form.control}
                  name="bio"
                  render={renderBioField}
                />

                <div className="space-y-3 pt-1">
                  <p className="text-sm font-medium">Social links</p>
                  {SOCIAL_FIELDS.map((item) => (
                    <SocialFormField
                      control={form.control}
                      item={item}
                      key={item.name}
                    />
                  ))}
                </div>

                <div className="flex justify-end pt-2">
                  <LoadingButton
                    className={cn(
                      "h-10 rounded-xl px-6",
                      ORANGE_GRADIENT_CLASS,
                      "hover:from-[#ffa629] hover:to-[#f56a14] active:translate-y-px"
                    )}
                    loading={isUpdating}
                    type="submit"
                  >
                    Save Changes
                  </LoadingButton>
                </div>
              </form>
            </Form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SocialFormFieldProps {
  control: Control<UpdateUserProfileValues>;
  item: SocialFieldConfig;
}

const SocialFormField = ({ control, item }: SocialFormFieldProps) => {
  const renderSocialField = useCallback(
    ({
      field,
    }: {
      field: ControllerRenderProps<UpdateUserProfileValues, SocialFieldName>;
    }) => <SocialFieldRenderer field={field} item={item} />,
    [item]
  );

  return (
    <FormField control={control} name={item.name} render={renderSocialField} />
  );
};

interface SocialFieldRendererProps {
  field: ControllerRenderProps<UpdateUserProfileValues, SocialFieldName>;
  item: SocialFieldConfig;
}

const SocialFieldRenderer = ({ field, item }: SocialFieldRendererProps) => (
  <FormItem>
    <FormLabel>{item.label}</FormLabel>
    <FormControl>
      <div className="relative">
        <Input
          className="premium-input h-10 rounded-xl px-3 text-sm"
          placeholder={item.placeholder}
          {...field}
        />
      </div>
    </FormControl>
    <FormMessage />
  </FormItem>
);
