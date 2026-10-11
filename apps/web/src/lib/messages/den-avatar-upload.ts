import { uploadMediaFile } from "@/lib/media/media-upload-client";
import type { UploadStage } from "@/lib/media/media-upload-client";

// A den avatar's upload, as a module rather than a function inside the create
// sheet.
//
// Two reasons, both learned the hard way. It reports through a result union
// instead of throwing because React Compiler cannot lower a throw inside
// component code. And it lives here so it can be tested without importing the
// dialog, which drags in the session provider, the identity key, the member
// picker and a Prisma pool - a whole test process held open to assert one
// argument.
export async function uploadDenAvatar(
  file: File,
  onStage: (stage: UploadStage) => void
): Promise<{ mediaId: string } | { error: string }> {
  try {
    const uploaded = await uploadMediaFile(file, {
      onStage,
      // "avatar", NOT "message". A message attachment has to be bound to a
      // conversation at upload time so the peer can be admitted, and this upload
      // happens BEFORE the den exists - there is no conversation to bind to, so
      // "message" was refused outright and picking a picture was impossible. An
      // avatar upload is owner-readable from the start, which is what the preview
      // needs, and the create route binds it to the new conversation afterwards so
      // the rest of the roster can load it too.
      purpose: "avatar",
    });
    if (uploaded.status === "REJECTED") {
      return {
        error:
          uploaded.rejectedReason === "MALWARE"
            ? "That file failed the security scan"
            : "That file was rejected",
      };
    }
    return { mediaId: uploaded.mediaId };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Couldn't upload that image",
    };
  }
}
