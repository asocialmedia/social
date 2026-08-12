import {
  type UpdateUserProfileValues,
  updateUserProfileSchema,
} from "@asm/auth/validation";
import type { UserData } from "@asm/db";
import {
  Dialog,
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
import { Camera, UserRound } from "lucide-react";
import Image, { type StaticImageData } from "next/image";
import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ControllerRenderProps,
  type UseFormReturn,
  useForm,
} from "react-hook-form";
import Resizer from "react-image-file-resizer";
import {
  useUpdateAvatarMutation,
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
  user: UserData;
}

const regex = /\s+/;

export default function EditProfileDialog({
  user,
  open,
  onOpenChange,
}: EditProfileDialogProps) {
  const { toast } = useToast();
  const form = useForm<UpdateUserProfileValues>({
    defaultValues: {
      bio: user.bio || "",
      displayName: user.displayName,
    },
    resolver: zodResolver(updateUserProfileSchema),
  });

  const [croppedAvatar, setCroppedAvatar] = useState<Blob | null>(null);
  const [gifToCenter, setGifToCenter] = useState<File | null>(null);
  const mutation = useUpdateAvatarMutation();
  const profileMutation = useUpdateProfileMutation();
  const isUpdating = mutation.isPending || profileMutation.isPending;

  // Keep a stable object URL for the cropped preview and revoke it on change/unmount.
  const croppedAvatarUrl = useMemo(
    () => (croppedAvatar ? URL.createObjectURL(croppedAvatar) : null),
    [croppedAvatar]
  );

  useEffect(
    () => () => {
      if (croppedAvatarUrl) {
        URL.revokeObjectURL(croppedAvatarUrl);
      }
    },
    [croppedAvatarUrl]
  );

  useEffect(() => {
    if (!open) {
      setCroppedAvatar(null);
      setGifToCenter(null);
      form.reset({
        bio: user.bio || "",
        displayName: user.displayName,
      });
    }
  }, [open, user, form.reset]);

  const checkForChanges = (values: UpdateUserProfileValues) => {
    const hasProfileChanges =
      values.displayName !== user.displayName || values.bio !== user.bio;
    const hasAvatarChanges = croppedAvatar || gifToCenter;
    return { hasAvatarChanges, hasProfileChanges };
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
      await mutation.mutateAsync({
        file,
        oldAvatarKey: user.avatarKey || undefined,
        userId: user.id,
      });
    }
  };

  const handleSubmit = async (values: UpdateUserProfileValues) => {
    try {
      const { hasProfileChanges, hasAvatarChanges } = checkForChanges(values);

      if (!(hasProfileChanges || hasAvatarChanges)) {
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
      }

      onOpenChange(false);
      toast({
        description: "Your profile is looking fresh!",
        title: "Profile Updated",
      });
    } catch (error) {
      console.error("Failed to update profile:", error);
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

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="apple-panel w-full max-w-120 gap-4 overflow-hidden p-0 sm:rounded-2xl"
        onClick={handleContentClick}
      >
        <div className="border-border/60 border-b px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2 font-semibold text-base">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg",
                ORANGE_GRADIENT_CLASS
              )}
            >
              <UserRound className="h-3.5 w-3.5" />
            </div>
            Edit Profile
          </DialogTitle>
          <DialogDescription className="mt-1 text-muted-foreground text-xs">
            Update your profile details
          </DialogDescription>
        </div>

        <div className="px-5 pb-5">
          <div className="space-y-1.5">
            <Label>Avatar</Label>
            <AvatarInput
              form={form}
              isUploading={mutation.isPending}
              onGifSelected={setGifToCenter}
              onImageCropped={setCroppedAvatar}
              src={croppedAvatarUrl ?? user.avatarUrl ?? avatarPlaceholder.src}
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

interface AvatarInputProps {
  form: UseFormReturn<UpdateUserProfileValues>;
  isUploading: boolean;
  onGifSelected: (file: File | null) => void;
  onImageCropped: (blob: Blob | null) => void;
  src: string | StaticImageData;
  user: UserData;
}

function AvatarInput({
  src,
  onImageCropped,
  onGifSelected,
  form,
  isUploading,
  user,
}: AvatarInputProps) {
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
        console.error("Error resizing image:", error);
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
      <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-[hsl(var(--background))] p-3 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
        <button
          className="group relative block shrink-0"
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
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">Change profile photo</p>
          <p className="mt-1 text-muted-foreground text-xs">
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
}
