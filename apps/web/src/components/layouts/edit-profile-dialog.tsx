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
import { Camera, ImagePlus, Trash2, X } from "lucide-react";
import Image from "next/image";
import type { StaticImageData } from "next/image";
import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type {
  Control,
  ControllerRenderProps,
  UseFormReturn,
} from "react-hook-form";
import Resizer from "react-image-file-resizer";

import {
  useDeleteAvatarMutation,
  useDeleteBannerMutation,
  useUpdateAvatarMutation,
  useUpdateBannerMutation,
  useUpdateProfileMutation,
} from "@/app/(main)/users/[username]/avatar-mutations";
import LoadingButton from "@/components/auth/loading-button";
import { AnimatedWordCounter } from "@/components/misc/animated-word-counter";
import { useToast } from "@/lib/gooey-toast";
import { cn, isGifUrl } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

import CropImageDialog from "./crop-image-dialog";
import GifCenteringDialog from "./gif-centering-dialog";

const ORANGE_GRADIENT_CLASS =
  "bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

interface EditProfileDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  user: PrivateUserData;
}

const regex = /\s+/;

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
  const [bannerRemoved, setBannerRemoved] = useState(false);
  const [avatarDeleted, setAvatarDeleted] = useState(false);
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

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-compiler -- reset editor state when the dialog closes
      setCroppedAvatar(null);
      setGifToCenter(null);
      setCroppedBanner(null);
      setBannerRemoved(false);
      setAvatarDeleted(false);
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
  }, [open, user, form.reset, form]);

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
    const hasAvatarDeleted = avatarDeleted && Boolean(user.avatarKey);
    const hasBannerChanges = Boolean(croppedBanner) || bannerRemoved;
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
      await avatarMutation.mutateAsync({
        file,
        oldAvatarKey: user.avatarKey || undefined,
        userId: user.id,
      });
    }
  };

  const updateBanner = async () => {
    if (croppedBanner) {
      const file = new File([croppedBanner], `banner_${user.id}.webp`, {
        type: "image/webp",
      });
      await bannerMutation.mutateAsync({
        file,
        oldBannerKey: user.bannerKey || undefined,
        userId: user.id,
      });
      return;
    }
    if (bannerRemoved && user.bannerKey) {
      await deleteBannerMutation.mutateAsync({
        bannerKey: user.bannerKey,
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
      } else if (hasAvatarDeleted && user.avatarKey) {
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
        className="apple-panel w-[calc(100%-1.5rem)] max-w-120 gap-4 overflow-hidden rounded-2xl border-0 p-0 [&>button:last-child]:hidden"
        onClick={handleContentClick}
      >
        {/* Flush square avatar fills the header's left edge; title and
            description sit to its right, with a 3D close button centered
            against the header row. */}
        <div className="border-border/60 flex items-center border-b py-2 pr-3 pl-3">
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

        <div className="max-h-[85vh] overflow-y-auto px-5 pb-5">
          <div className="space-y-1.5">
            <Label>Header image</Label>
            <BannerInput
              canRemove={Boolean(user.bannerUrl)}
              isRemoved={bannerRemoved}
              isUploading={bannerMutation.isPending}
              onBannerCropped={setCroppedBanner}
              onRemove={handleRemoveBanner}
              src={
                croppedBannerUrl ??
                (bannerRemoved ? "" : (user.bannerUrl ?? ""))
              }
            />
          </div>

          <div className="mt-4 space-y-1.5">
            <Label>Avatar</Label>
            <AvatarInput
              canDelete={Boolean(user.avatarUrl || user.avatarKey)}
              form={form}
              isDeleted={avatarDeleted}
              isUploading={avatarMutation.isPending}
              onDelete={handleDeleteAvatar}
              onGifSelected={setGifToCenter}
              onImageCropped={setCroppedAvatar}
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

interface BannerInputProps {
  canRemove: boolean;
  isRemoved: boolean;
  isUploading: boolean;
  onBannerCropped: (blob: Blob | null) => void;
  onRemove: () => void;
  src: string;
}

const BannerInput = ({
  src,
  canRemove,
  isRemoved,
  onBannerCropped,
  onRemove,
  isUploading,
}: BannerInputProps) => {
  const { toast } = useToast();
  const [imageToCrop, setImageToCrop] = useState<File>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bannerSrc = useMemo(() => {
    if (src && !src.startsWith("blob:")) {
      return getSecureImageUrl(src);
    }
    return src;
  }, [src]);

  const resetInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const onImageSelected = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }

      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        toast({
          description: "That image is over 10MB, try a smaller one",
          title: "File Too Big",
          variant: "destructive",
        });
        return;
      }

      try {
        Resizer.imageFileResizer(
          file,
          1500,
          500,
          "WEBP",
          90,
          0,
          (uri) => setImageToCrop(uri as File),
          "file",
          1500,
          500
        );
      } catch (error) {
        clientLog.error("Error resizing image:", error);
        toast({
          description: "That image didn't work, try a different one",
          title: "Couldn't Process Image",
          variant: "destructive",
        });
        resetInput();
      }
    },
    [toast, resetInput]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onImageSelected(e.target.files?.[0]);
    },
    [onImageSelected]
  );

  const handleBannerClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleCropClose = useCallback(() => {
    setImageToCrop(undefined);
    resetInput();
  }, [resetInput]);

  const handleCropped = useCallback(
    (blob: Blob | null) => {
      if (blob) {
        onBannerCropped(blob);
      }
    },
    [onBannerCropped]
  );

  const handleRemoveClick = useCallback(() => {
    onRemove();
    resetInput();
  }, [onRemove, resetInput]);

  return (
    <>
      <input
        accept="image/jpeg,image/png,image/webp"
        className="sr-only hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
      <div className="relative">
        <button
          className="group border-border/60 relative block h-28 w-full overflow-hidden rounded-xl border bg-[hsl(var(--background))] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]"
          disabled={isUploading}
          onClick={handleBannerClick}
          type="button"
        >
          {bannerSrc && !isRemoved ? (
            <Image
              alt="Header preview"
              className="object-cover"
              fill
              sizes="480px"
              src={bannerSrc}
              unoptimized={
                typeof bannerSrc === "string" &&
                (bannerSrc.includes("asmob") || bannerSrc.startsWith("blob:"))
              }
            />
          ) : (
            <div className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 bg-linear-to-br from-[#ff9500]/10 via-transparent to-[#e65500]/10 text-sm">
              <ImagePlus className="h-4 w-4" />
              Add a header image
            </div>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            {isUploading ? (
              <span className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Camera className="h-6 w-6 text-white" />
            )}
          </span>
        </button>

        {/* Trash sits on the image itself instead of a separate full-width
            row below; sibling of the preview button so buttons never nest. */}
        {canRemove && !isRemoved ? (
          <button
            aria-label="Remove header image"
            className="hover:bg-destructive absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-full border-0 bg-black/50 text-white backdrop-blur-sm transition-colors duration-200 active:translate-y-px"
            disabled={isUploading}
            onClick={handleRemoveClick}
            type="button"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>

      {imageToCrop ? (
        <CropImageDialog
          cropAspectRatio={3}
          onClose={handleCropClose}
          onCropped={handleCropped}
          src={URL.createObjectURL(imageToCrop)}
        />
      ) : null}
    </>
  );
};

interface AvatarInputProps {
  canDelete: boolean;
  form: UseFormReturn<UpdateUserProfileValues>;
  isDeleted: boolean;
  isUploading: boolean;
  onDelete: () => void;
  onGifSelected: (file: File | null) => void;
  onImageCropped: (blob: Blob | null) => void;
  src: string | StaticImageData;
  user: PrivateUserData;
}

const AvatarInput = ({
  canDelete,
  src,
  onImageCropped,
  onGifSelected,
  form,
  isDeleted,
  onDelete,
  isUploading,
  user,
}: AvatarInputProps) => {
  const { toast } = useToast();
  const [imageToCrop, setImageToCrop] = useState<File>();
  const [gifToCenter, setGifToCenter] = useState<File>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const avatarSrc = useMemo(() => {
    if (typeof src === "string" && !src.startsWith("blob:")) {
      return getSecureImageUrl(src);
    }
    return typeof src === "string" ? src : avatarPlaceholder.src;
  }, [src]);

  const resetInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const onImageSelected = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }

      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        toast({
          description: "That image is over 10MB, try a smaller one",
          title: "File Too Big",
          variant: "destructive",
        });
        return;
      }

      if (file.type === "image/gif") {
        setGifToCenter(file);
        onGifSelected(file);
        return;
      }

      try {
        Resizer.imageFileResizer(
          file,
          1024,
          1024,
          "WEBP",
          90,
          0,
          (uri) => setImageToCrop(uri as File),
          "file",
          512,
          512
        );
      } catch (error) {
        clientLog.error("Error resizing image:", error);
        toast({
          description: "That image didn't work, try a different one",
          title: "Couldn't Process Image",
          variant: "destructive",
        });
        resetInput();
      }
    },
    [toast, onGifSelected, resetInput]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onImageSelected(e.target.files?.[0]);
    },
    [onImageSelected]
  );

  const handleAvatarClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAvatarError = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      (e.target as HTMLImageElement).src = avatarPlaceholder.src;
    },
    []
  );

  const handleGifClose = useCallback(() => {
    setGifToCenter(undefined);
    resetInput();
  }, [resetInput]);

  const handleCropClose = useCallback(() => {
    setImageToCrop(undefined);
    resetInput();
  }, [resetInput]);

  const handleCropped = useCallback(
    (blob: Blob | null) => {
      if (blob) {
        onImageCropped(blob);
      }
    },
    [onImageCropped]
  );

  return (
    <>
      <input
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
      <div className="border-border/60 flex items-center gap-4 rounded-xl border bg-[hsl(var(--background))] p-3 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="relative shrink-0">
          <button
            className="group relative block"
            disabled={isUploading}
            onClick={handleAvatarClick}
            type="button"
          >
            <Image
              alt="Avatar preview"
              className={cn(
                "avatar-ring size-24 flex-none rounded-full object-cover",
                isUploading && "opacity-50"
              )}
              height={150}
              onError={handleAvatarError}
              src={avatarSrc}
              unoptimized={
                typeof avatarSrc === "string" &&
                (isGifUrl(avatarSrc) ||
                  avatarSrc.includes("asmob") ||
                  avatarSrc.startsWith("blob:"))
              }
              width={150}
            />
            <span className="absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full bg-black/40 text-white ring-2 ring-white/50 transition-colors duration-200 group-hover:bg-black/30">
              {isUploading ? (
                <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Camera size={20} />
              )}
            </span>
          </button>
          {canDelete && !isDeleted ? (
            <button
              aria-label="Remove avatar"
              className="hover:bg-destructive absolute top-1 right-1 z-10 flex size-6 items-center justify-center rounded-full border-0 bg-black/50 text-white transition-colors duration-200 active:translate-y-px"
              disabled={isUploading}
              onClick={onDelete}
              type="button"
            >
              <Trash2 className="size-3" />
            </button>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Change profile photo</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Supports JPG, PNG, and GIF (under 10MB)
          </p>
        </div>
      </div>

      {gifToCenter ? (
        <GifCenteringDialog
          currentValues={{
            bio: form.getValues("bio"),
            displayName: form.getValues("displayName"),
            oldAvatarKey: user.avatarKey || undefined,
            userId: user.id,
          }}
          gifFile={gifToCenter}
          onClose={handleGifClose}
        />
      ) : null}

      {imageToCrop ? (
        <CropImageDialog
          cropAspectRatio={1}
          onClose={handleCropClose}
          onCropped={handleCropped}
          src={URL.createObjectURL(imageToCrop)}
        />
      ) : null}
    </>
  );
};
