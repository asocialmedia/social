import { useEffect, useState } from "react";

import {
  useUpdateAvatarMutation,
  useUpdateBannerMutation,
} from "@/app/(main)/users/[username]/avatar-mutations";

import CropImageDialog from "./crop-image-dialog";

export default function GifCenteringDialog({
  gifFile,
  onClose,
  currentValues,
  target,
}: {
  currentValues: { userId: string };
  gifFile: File;
  onClose: () => void;
  target: "avatar" | "banner";
}) {
  const avatarMutation = useUpdateAvatarMutation();
  const bannerMutation = useUpdateBannerMutation();
  const mutation = target === "banner" ? bannerMutation : avatarMutation;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(gifFile);
    // oxlint-disable-next-line react/set-state-in-effect -- Object URLs belong to the effect lifetime, including Strict Mode remounts.
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [gifFile]);
  if (!src) {
    return null;
  }
  return (
    <CropImageDialog
      animated
      src={src}
      cropAspectRatio={target === "banner" ? 3 : 1}
      onClose={onClose}
      onCropped={async (blob) => {
        if (!blob) {
          return;
        }
        if (blob.size > 10 * 1024 * 1024) {
          throw new Error("The cropped GIF is over 10MB. Try a smaller file.");
        }
        await mutation.mutateAsync({
          file: new File([blob], `${target}-${Date.now()}.gif`, {
            type: "image/gif",
          }),
          userId: currentValues.userId,
        });
      }}
    />
  );
}
