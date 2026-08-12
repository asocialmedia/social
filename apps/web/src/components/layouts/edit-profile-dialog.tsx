import {
  type UpdateUserProfileValues,
  updateUserProfileSchema,
} from "@asm/auth/validation";
import type { UserData } from "@asm/db";
import { useToast } from "@asm/ui/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
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
import { Camera } from "lucide-react";
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
import { cn, isGifUrl } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";
import CropImageDialog from "./crop-image-dialog";
import GifCenteringDialog from "./gif-centering-dialog";

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
          description: "No changes were made to your profile",
          title: "No changes",
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
        description: "Profile updated successfully",
        title: "Success",
      });
    } catch (error) {
      console.error("Failed to update profile:", error);
      toast({
        description:
          error instanceof Error ? error.message : "An error occurred",
        title: "Error",
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
          <Input placeholder="Your display name" {...field} />
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
              className="resize-none"
              placeholder="Tell us a little bit about yourself"
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

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Avatar</Label>
          <AvatarInput
            form={form}
            isUploading={mutation.isPending}
            onGifSelected={setGifToCenter}
            onImageCropped={setCroppedAvatar}
            src={
              croppedAvatar
                ? URL.createObjectURL(croppedAvatar)
                : (user.avatarUrl ?? avatarPlaceholder.src)
            }
            user={user}
          />
        </div>
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
            <DialogFooter>
              <LoadingButton loading={isUpdating} type="submit">
                Save
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
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
    if (typeof src === "string") {
      return getSecureImageUrl(src);
    }
    return avatarPlaceholder.src;
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
          description: "Image must be less than 10MB",
          title: "File too large",
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
          description:
            "Failed to resize the image. Please try again with a different image.",
          title: "Error processing image",
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
      <div className="space-y-2">
        <button
          className="group relative block"
          disabled={isUploading}
          onClick={handleAvatarClick}
          type="button"
        >
          <Image
            alt="Avatar preview"
            className={cn(
              "size-32 flex-none rounded-full object-cover",
              isUploading && "opacity-50"
            )}
            height={150}
            onError={handleAvatarError}
            src={avatarSrc}
            unoptimized={
              typeof avatarSrc === "string" &&
              (isGifUrl(avatarSrc) || avatarSrc.includes("asmob"))
            }
            width={150}
          />
          <span className="absolute inset-0 m-auto flex size-12 items-center justify-center rounded-full bg-black/30 text-white transition-colors duration-200 group-hover:bg-black/25">
            {isUploading ? (
              <span className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Camera size={24} />
            )}
          </span>
        </button>
        <p className="text-muted-foreground text-xs">
          Supports JPG, PNG, and GIF (under 8MB)
        </p>
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
