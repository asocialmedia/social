import type { Media } from "@asm/db";
import { MediaPreviews } from "@/components/home/feedview/media-previews";
import { AttachmentPreview } from "@/components/posts/editor/attachment-preview";
import type { Attachment } from "../types";

interface SupportMediaPreviewProps {
  attachments: Attachment[];
  onRemove: (index: number) => void;
  uploadedMedia?: Media[];
}

export function SupportMediaPreview({
  attachments,
  onRemove,
  uploadedMedia,
}: SupportMediaPreviewProps) {
  return (
    <div className="space-y-4">
      {attachments.map((attachment, index) => (
        <AttachmentPreview
          attachment={{
            file: attachment.file,
            isUploading: false,
          }}
          key={attachment.key}
          onRemoveClick={() => {
            if (attachment.previewUrl) {
              URL.revokeObjectURL(attachment.previewUrl);
            }
            onRemove(index);
          }}
        />
      ))}
      {uploadedMedia && uploadedMedia.length > 0 && (
        <MediaPreviews attachments={uploadedMedia} />
      )}
    </div>
  );
}
