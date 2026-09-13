"use client";

import { updateUserProfileSchema } from "@asm/auth/validation";
import type { UpdateUserProfileValues } from "@asm/auth/validation";
import type { PrivateUserData } from "@asm/db";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@asm/ui/shadui/form";
import { Input } from "@asm/ui/shadui/input";
import avatarPlaceholder from "@assets/general/avatar-placeholder.png";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link2, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import type { Control, ControllerRenderProps } from "react-hook-form";
import type { IconType } from "react-icons";
import { FaGithub, FaLinkedin, FaReddit, FaXTwitter } from "react-icons/fa6";

import {
  useDeleteAvatarMutation,
  useDeleteBannerMutation,
  useUpdateAvatarMutation,
  useUpdateBannerMutation,
  useUpdateProfileMutation,
} from "@/app/(main)/users/[username]/avatar-mutations";
import { LoadingButton } from "@/components/auth/loading-button";
import { AnimatedWordCounter } from "@/components/misc/animated-word-counter";
import { InlineRichEditor } from "@/components/posts/editor/inline-rich-editor";
import {
  AvatarInput,
  BannerInput,
} from "@/components/profile/profile-media-inputs";
import {
  ORANGE_GRADIENT_CLASS,
  SettingsCard,
  SettingsSectionHeader,
} from "@/components/settings/settings-section-card";
import { useToast } from "@/lib/gooey-toast";
import type { UploadStage } from "@/lib/media/media-upload-client";
import { cn } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

const whitespaceRegex = /\s+/;

interface SocialFieldConfig {
  icon: IconType;
  label: string;
  name:
    | "githubUsername"
    | "linkedinUsername"
    | "twitterUsername"
    | "redditUsername";
  placeholder: string;
}

const SOCIAL_FIELDS: SocialFieldConfig[] = [
  {
    icon: FaGithub,
    label: "GitHub",
    name: "githubUsername",
    placeholder: "octocat",
  },
  {
    icon: FaLinkedin,
    label: "LinkedIn",
    name: "linkedinUsername",
    placeholder: "john-doe",
  },
  {
    icon: FaXTwitter,
    label: "Twitter / X",
    name: "twitterUsername",
    placeholder: "yourhandle",
  },
  {
    icon: FaReddit,
    label: "Reddit",
    name: "redditUsername",
    placeholder: "yourusername",
  },
];

const DisplayNameFieldRenderer = ({
  field,
}: {
  field: ControllerRenderProps<UpdateUserProfileValues, "displayName">;
}) => (
  <FormItem>
    <FormLabel className="text-xs">Display name</FormLabel>
    <FormControl>
      <Input
        className="premium-input h-10 rounded-xl text-sm"
        placeholder="Your display name"
        {...field}
      />
    </FormControl>
    <FormMessage />
  </FormItem>
);

const BioFieldRenderer = ({
  field,
}: {
  field: ControllerRenderProps<UpdateUserProfileValues, "bio">;
}) => (
  <FormItem>
    <FormLabel>Bio</FormLabel>
    <FormControl>
      <div className="space-y-1">
        <InlineRichEditor
          className="premium-input rounded-xl"
          editorClassName="max-h-40 min-h-20 overflow-y-auto px-3 py-2 text-sm leading-relaxed"
          enableLinks
          initialContent={field.value}
          onChange={(value) => field.onChange(value)}
          placeholder="Tell us a little bit about yourself - @mention, #tag or drop a link"
        />
        <div className="flex justify-end">
          <AnimatedWordCounter
            current={
              field.value.trim().split(whitespaceRegex).filter(Boolean).length
            }
            max={400}
          />
        </div>
      </div>
    </FormControl>
    <FormMessage />
  </FormItem>
);

const SocialFieldRenderer = ({
  field,
  item,
}: {
  field: ControllerRenderProps<
    UpdateUserProfileValues,
    SocialFieldConfig["name"]
  >;
  item: SocialFieldConfig;
}) => {
  const Icon = item.icon;
  return (
    <FormItem>
      <FormLabel>{item.label}</FormLabel>
      <FormControl>
        <div className="relative">
          <Icon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            className="premium-input h-10 rounded-xl pr-3 pl-10 text-sm"
            placeholder={item.placeholder}
            {...field}
          />
        </div>
      </FormControl>
      <FormMessage />
    </FormItem>
  );
};

const SocialFormField = ({
  control,
  item,
}: {
  control: Control<UpdateUserProfileValues>;
  item: SocialFieldConfig;
}) => (
  <FormField
    control={control}
    name={item.name}
    render={({ field }) => <SocialFieldRenderer field={field} item={item} />}
  />
);

interface ProfileSettingsProps {
  // Switches the settings view to the Account tab's username section.
  onNavigateToAccount?: () => void;
  user: PrivateUserData;
}

export default function ProfileSettings({
  user,
  onNavigateToAccount,
}: ProfileSettingsProps) {
  const { toast } = useToast();
  const form = useForm<UpdateUserProfileValues>({
    defaultValues: {
      bio: user.bio || "",
      displayName: user.displayName,
      githubUsername: user.githubUsername ?? "",
      linkedinUsername: user.linkedinUsername ?? "",
      redditUsername: user.redditUsername ?? "",
      twitterUsername: user.twitterUsername ?? "",
    },
    resolver: zodResolver(updateUserProfileSchema),
  });

  // Pending media edits: held locally and uploaded together with the profile
  // fields on Save, exactly like the edit-profile dialog. The "state" pairs
  // track the committed avatar/header so the hero reflects a successful upload
  // without waiting on a server round-trip.
  const [croppedAvatar, setCroppedAvatar] = useState<Blob | null>(null);
  const [gifToCenter, setGifToCenter] = useState<File | null>(null);
  const [croppedBanner, setCroppedBanner] = useState<Blob | null>(null);
  const [bannerGif, setBannerGif] = useState<File | null>(null);
  const [bannerRemoved, setBannerRemoved] = useState(false);
  const [avatarDeleted, setAvatarDeleted] = useState(false);
  const [avatarStage, setAvatarStage] = useState<UploadStage | null>(null);
  const [avatarProgress, setAvatarProgress] = useState(0);
  const [bannerStage, setBannerStage] = useState<UploadStage | null>(null);
  const [bannerProgress, setBannerProgress] = useState(0);
  const [avatarState, setAvatarState] = useState<{
    key: string | null;
    url: string | null;
  }>({ key: user.avatarKey ?? null, url: user.avatarUrl ?? null });
  const [bannerState, setBannerState] = useState<{
    key: string | null;
    url: string | null;
  }>({ key: user.bannerKey ?? null, url: user.bannerUrl ?? null });

  const avatarMutation = useUpdateAvatarMutation();
  const bannerMutation = useUpdateBannerMutation();
  const deleteAvatarMutation = useDeleteAvatarMutation();
  const deleteBannerMutation = useDeleteBannerMutation();
  const profileMutation = useUpdateProfileMutation();
  const isUpdating =
    avatarMutation.isPending ||
    bannerMutation.isPending ||
    profileMutation.isPending ||
    deleteAvatarMutation.isPending ||
    deleteBannerMutation.isPending;

  const croppedAvatarUrl = useMemo(
    () => (croppedAvatar ? URL.createObjectURL(croppedAvatar) : null),
    [croppedAvatar]
  );
  const croppedBannerUrl = useMemo(
    () => (croppedBanner ? URL.createObjectURL(croppedBanner) : null),
    [croppedBanner]
  );

  // Release the local previews when they are replaced or the tab unmounts.
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

  const removeBanner = () => {
    setBannerRemoved(true);
    setCroppedBanner(null);
    setBannerGif(null);
  };

  const deleteAvatar = () => {
    setCroppedAvatar(null);
    setGifToCenter(null);
    setAvatarDeleted(true);
  };

  async function uploadAvatar() {
    const file = croppedAvatar
      ? new File([croppedAvatar], `avatar_${user.id}.webp`, {
          type: "image/webp",
        })
      : gifToCenter;
    if (!file) {
      return;
    }
    setAvatarStage("uploading");
    setAvatarProgress(0);
    try {
      const result = await avatarMutation.mutateAsync({
        file,
        onProgress: setAvatarProgress,
        onStage: setAvatarStage,
        userId: user.id,
      });
      setAvatarState({
        key: result.avatar.key,
        url: getSecureImageUrl(result.avatar.url),
      });
      setAvatarStage(null);
      setAvatarProgress(0);
    } catch (error) {
      setAvatarStage(null);
      setAvatarProgress(0);
      throw error;
    }
  }

  async function uploadBanner() {
    const file = croppedBanner
      ? new File([croppedBanner], `banner_${user.id}.webp`, {
          type: "image/webp",
        })
      : bannerGif;
    if (!file) {
      return;
    }
    setBannerStage("uploading");
    setBannerProgress(0);
    try {
      const result = await bannerMutation.mutateAsync({
        file,
        onProgress: setBannerProgress,
        onStage: setBannerStage,
        userId: user.id,
      });
      setBannerState({
        key: result.banner.key,
        url: getSecureImageUrl(result.banner.url),
      });
      setBannerStage(null);
      setBannerProgress(0);
    } catch (error) {
      setBannerStage(null);
      setBannerProgress(0);
      throw error;
    }
  }

  async function onSubmit(values: UpdateUserProfileValues) {
    const hasProfileChanges =
      values.displayName !== user.displayName ||
      values.bio !== (user.bio ?? "") ||
      values.githubUsername !== (user.githubUsername ?? "") ||
      values.linkedinUsername !== (user.linkedinUsername ?? "") ||
      values.twitterUsername !== (user.twitterUsername ?? "") ||
      values.redditUsername !== (user.redditUsername ?? "");
    const hasAvatarChanges = Boolean(croppedAvatar || gifToCenter);
    const hasAvatarDeleted =
      avatarDeleted && Boolean(avatarState.url || avatarState.key);
    const hasBannerChanges =
      Boolean(croppedBanner || bannerGif) ||
      (bannerRemoved && Boolean(bannerState.url || bannerState.key));

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

    try {
      if (hasProfileChanges) {
        await profileMutation.mutateAsync({ userId: user.id, values });
      }

      if (hasAvatarChanges) {
        await uploadAvatar();
      } else if (hasAvatarDeleted) {
        await deleteAvatarMutation.mutateAsync({ userId: user.id });
        setAvatarState({ key: null, url: null });
      }

      if (hasBannerChanges) {
        if (croppedBanner || bannerGif) {
          await uploadBanner();
        } else if (bannerRemoved && (bannerState.url || bannerState.key)) {
          await deleteBannerMutation.mutateAsync({
            bannerKey: bannerState.key ?? "",
            userId: user.id,
          });
          setBannerState({ key: null, url: null });
        }
      }

      // The pending picks are now committed; clear them so a second Save
      // doesn't re-upload the same file.
      setCroppedAvatar(null);
      setGifToCenter(null);
      setCroppedBanner(null);
      setBannerGif(null);
      setBannerRemoved(false);
      setAvatarDeleted(false);

      toast({
        description: "Your profile is looking fresh!",
        title: "Profile Updated",
      });
    } catch {
      toast({
        description: "Something went wrong, try again?",
        title: "Couldn't Save",
        variant: "destructive",
      });
    }
  }

  const bannerSrc =
    croppedBannerUrl ?? (bannerRemoved ? "" : (bannerState.url ?? ""));
  const avatarSrc = avatarDeleted
    ? avatarPlaceholder.src
    : (croppedAvatarUrl ?? avatarState.url ?? avatarPlaceholder.src);

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <SettingsSectionHeader
        description="How you appear across asocialmedia"
        icon={UserRound}
        title="Profile"
      />

      <Form {...form}>
        <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
          {/* Profile hero: the header image spans the top, the avatar
              overlaps its lower-left by half, and the display-name field
              sits beside the avatar. */}
          <SettingsCard
            className="scroll-mt-24 overflow-hidden p-0 sm:p-0"
            id="settings-profile"
          >
            <BannerInput
              className="h-36 rounded-none border-0 sm:h-44"
              canRemove={Boolean(bannerState.url || bannerState.key)}
              isRemoved={bannerRemoved}
              isUploading={bannerMutation.isPending}
              onBannerCropped={setCroppedBanner}
              onGifSelected={setBannerGif}
              onRemove={removeBanner}
              progress={bannerProgress}
              src={bannerSrc}
              stage={bannerStage}
              user={user}
            />

            <div className="flex items-start gap-4 px-4 pb-5 sm:px-6">
              <div className="-mt-14 shrink-0 sm:-mt-18">
                <AvatarInput
                  className="size-28 ring-4 ring-[hsl(var(--background))] sm:size-36"
                  canDelete={Boolean(avatarState.url || avatarState.key)}
                  isDeleted={avatarDeleted}
                  isUploading={avatarMutation.isPending}
                  onDelete={deleteAvatar}
                  onGifSelected={setGifToCenter}
                  onImageCropped={setCroppedAvatar}
                  progress={avatarProgress}
                  shape="squircle"
                  src={avatarSrc}
                  stage={avatarStage}
                  user={user}
                  variant="bare"
                />
              </div>

              <div className="min-w-0 flex-1 pt-2 sm:pt-3">
                <FormField
                  control={form.control}
                  name="displayName"
                  render={DisplayNameFieldRenderer}
                />
                <p className="text-muted-foreground mt-2 text-xs leading-snug">
                  Want to edit your username?{" "}
                  <button
                    className="text-primary cursor-pointer font-medium hover:underline"
                    onClick={() => onNavigateToAccount?.()}
                    type="button"
                  >
                    Visit here
                  </button>
                </p>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard>
            <div className="space-y-5">
              <FormField
                control={form.control}
                name="bio"
                render={BioFieldRenderer}
              />

              <div className="pt-1">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Link2 className="text-muted-foreground h-4 w-4" />
                  Social links
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {SOCIAL_FIELDS.map((item) => (
                    <SocialFormField
                      control={form.control}
                      item={item}
                      key={item.name}
                    />
                  ))}
                </div>
              </div>
            </div>
          </SettingsCard>

          <div className="flex justify-end">
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
  );
}
