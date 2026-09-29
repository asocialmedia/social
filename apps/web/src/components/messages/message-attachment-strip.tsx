"use client";

import { RefreshCw, X } from "lucide-react";
import Image from "next/image";

import { getUploadProgressInfo } from "@/lib/media/upload-progress";
import { cn } from "@/lib/utils";

import type { MessageAttachmentDraft } from "./message-attachment-state";

function AttachmentTile({
  attachment,
  onEdit,
  onRemove,
  onRetry,
}: {
  attachment: MessageAttachmentDraft;
  onEdit: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const uploading = attachment.status === "uploading";
  const errored = attachment.status === "error";
  const { percent } = getUploadProgressInfo(
    uploading ? attachment.stage : undefined,
    attachment.progress
  );

  return (
    <li
      className={cn(
        "surface-3d group relative size-16 shrink-0 overflow-hidden rounded-xl",
        errored && "ring-1 ring-red-500/60"
      )}
    >
      <Image
        alt=""
        className={cn(
          "object-cover transition-opacity duration-200",
          errored ? "opacity-40" : "opacity-100"
        )}
        fill
        sizes="64px"
        src={attachment.objectUrl}
        unoptimized
      />

      {uploading ? (
        <>
          <span className="pointer-events-none absolute inset-0 bg-black/35" />
          {/* oxlint-disable jsx-a11y/prefer-tag-over-role -- thin gradient fill bar inside a 64px tile; native <progress> cannot render this shape */}
          <span
            aria-label="Uploading image"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={percent}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/50"
            role="progressbar"
          >
            <span
              className="block h-full bg-linear-to-r from-[#ff9500] to-[#e65500] transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          </span>
          {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
          <span className="sr-only">Uploading image {percent}%</span>
        </>
      ) : null}

      {errored ? (
        <button
          aria-label="Retry upload"
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-black/45 text-white"
          onClick={onRetry}
          type="button"
        >
          <RefreshCw className="size-4" />
          <span className="text-[9px] font-medium">Retry</span>
        </button>
      ) : (
        <button
          aria-label="Preview and edit image"
          className="absolute inset-0 z-10 outline-hidden focus-visible:ring-2 focus-visible:ring-white/80"
          onClick={onEdit}
          type="button"
        />
      )}

      <button
        aria-label="Remove image"
        className="icon-btn-3d absolute top-0.5 right-0.5 z-30 flex size-5 items-center justify-center rounded-full"
        onClick={onRemove}
        type="button"
      >
        <X className="size-3" />
      </button>
    </li>
  );
}

export function MessageAttachmentStrip({
  attachments,
  onEdit,
  onRemove,
  onRetry,
}: {
  attachments: MessageAttachmentDraft[];
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <ul
      aria-label="Attached images"
      className="mb-2 flex [scrollbar-width:none] list-none gap-2 overflow-x-auto overscroll-x-contain p-0 pb-0.5 [&::-webkit-scrollbar]:hidden"
    >
      {attachments.map((attachment) => (
        <AttachmentTile
          attachment={attachment}
          key={attachment.id}
          onEdit={() => onEdit(attachment.id)}
          onRemove={() => onRemove(attachment.id)}
          onRetry={() => onRetry(attachment.id)}
        />
      ))}
    </ul>
  );
}
