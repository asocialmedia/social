import type { Media } from "@asm/db";
import { useCallback } from "react";
import { MediaPreviews } from "@/components/home/feedview/media-previews";
import { AttachmentPreview } from "@/components/posts/editor/attachment-preview";
import type { Attachment } from "../types";

interface SupportMediaPreviewProps {
  attachments: Attachment[];
  onRemove: (index: number) => void;
  uploadedMedia?: Media[];
}

interface AttachmentRowProps {
  attachment: Attachment;
  index: number;
  onRemove: (index: number) => void;
}

function AttachmentRow({ attachment, index, onRemove }: AttachmentRowProps) {
  const handleRemoveClick = useCallback(() => {
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
    onRemove(index);
  }, [attachment.previewUrl, index, onRemove]);

  return (
    <AttachmentPreview
      attachment={{
        file: attachment.file,
        isUploading: false,
      }}
      onRemoveClick={handleRemoveClick}
    />
  );
}

export function SupportMediaPreview({
  attachments,
  onRemove,
  uploadedMedia,
}: SupportMediaPreviewProps) {
  return (
    <div className="space-y-4">
      {attachments.map((attachment, index) => (
        <AttachmentRow
          attachment={attachment}
          index={index}
          key={attachment.key}
          onRemove={onRemove}
        />
      ))}
      {uploadedMedia && uploadedMedia.length > 0 && (
        <MediaPreviews attachments={uploadedMedia} />
      )}
    </div>
  );
}
