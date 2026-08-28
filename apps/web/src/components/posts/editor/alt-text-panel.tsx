import { Button } from "@asm/ui/shadui/button";
import { Textarea } from "@asm/ui/shadui/textarea";
import { FileAudioIcon, FileIcon, Play, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

import type { Attachment } from "@/components/posts/editor/attachment-store";
import { formatFileName } from "@/lib/format-file-name";
import { ALT_TEXT_MAX_LENGTH } from "@/lib/media-upload-client";

interface AltTextPanelProps {
  attachment: Attachment;
  /**
   * Docked variant (gust): renders as a bare input styled like the caption
   * bar - no panel chrome, no buttons. The draft is controlled by the parent
   * and flushed when the gust is published.
   */
  compact?: boolean;
  /** Controlled draft for the docked variant; parent owns unsaved text. */
  draftValue?: string;
  onClose: () => void;
  onDraftChange?: (draft: string) => void;
  /** Receives the trimmed draft; "" clears a previously saved value. */
  onSave: (fileName: string, altText: string) => void;
}

/** Noun for the panel copy, from the attachment's MIME family. */
function mediaKindNoun(mimeType: string): string {
  if (mimeType.startsWith("video")) {
    return "video";
  }
  if (mimeType.startsWith("audio")) {
    return "audio";
  }
  return "media";
}

// Composer-side alt text editor. Renders INLINE under the attachment grid
// (same expanding-panel idiom as the GIF picker) instead of a modal - the
// editor context stays visible while writing. Saving PATCHes the media row
// directly; publish does not carry media metadata.
const AltTextPanel = ({
  attachment,
  compact = false,
  draftValue,
  onClose,
  onDraftChange,
  onSave,
}: AltTextPanelProps) => {
  const fileName = attachment.file?.name ?? attachment.name ?? "attachment";
  const mimeType = attachment.type ?? attachment.file?.type ?? "";
  const [internalDraft, setInternalDraft] = useState(attachment.altText ?? "");
  // Docked variant is controlled (parent flushes the draft on publish);
  // popover variant owns its draft until Done/Remove.
  const isControlled = onDraftChange !== undefined;
  const draft = isControlled
    ? (draftValue ?? attachment.altText ?? "")
    : internalDraft;
  const setDraft = (value: string) => {
    if (isControlled) {
      onDraftChange(value);
    } else {
      setInternalDraft(value);
    }
  };

  // Fresh uploads preview from a blob; restored drafts already have a media
  // URL so there is nothing to create.
  const [previewUrl, setPreviewUrl] = useState(attachment.mediaUrl ?? "");
  useEffect(() => {
    if (compact || attachment.mediaUrl || !attachment.file) {
      return;
    }
    const url = URL.createObjectURL(attachment.file);
    // eslint-disable-next-line react-compiler -- object URLs must be created after mount
    // oxlint-disable-next-line react/set-state-in-effect -- the blob URL only comes from the browser's object registry after mount
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [compact, attachment.file, attachment.mediaUrl]);

  const hasSavedText = Boolean(attachment.altText);
  // The cap is silent until hit - maxLength already prevents overshooting,
  // so the counter only appears at the moment typing stops working.
  const atLimit = draft.length >= ALT_TEXT_MAX_LENGTH;

  const handleSave = () => {
    onSave(fileName, draft.trim().slice(0, ALT_TEXT_MAX_LENGTH));
    // The docked gust variant stays open - it is part of the composer, not a
    // transient dialog.
    if (!compact) {
      onClose();
    }
  };

  const handleRemove = () => {
    onSave(fileName, "");
    if (!compact) {
      onClose();
    }
  };

  const renderPreview = () => {
    if (!previewUrl) {
      return <FileIcon className="text-muted-foreground size-7" />;
    }
    if (mimeType.startsWith("image")) {
      return (
        <Image
          alt={fileName}
          className="h-full w-full object-cover"
          fill
          sizes="144px"
          src={previewUrl}
        />
      );
    }
    if (mimeType.startsWith("video")) {
      return (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- composer preview of the user's own upload */}
          <video
            className="h-full w-full object-cover"
            controls
            muted
            playsInline
            preload="metadata"
            src={previewUrl}
          />
          <span className="pointer-events-none absolute right-1.5 bottom-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/50">
            <Play className="size-2.5 fill-white text-white" />
          </span>
        </>
      );
    }
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2 text-center">
        {mimeType.startsWith("audio") ? (
          <FileAudioIcon className="text-primary size-7" />
        ) : (
          <FileIcon className="text-primary size-7" />
        )}
        <p className="w-full truncate px-1 text-[11px] font-medium">
          {formatFileName(fileName)}
        </p>
      </div>
    );
  };

  if (compact) {
    // Mirrors the caption bar above it exactly: same premium-input surface,
    // same padding, same focus ring - a plain textarea carrying the caption
    // input's class set (the shadui Textarea chrome would fight it). The
    // draft rides to the media row on publish, so there is nothing to click.
    return (
      <textarea
        aria-label="Alt text"
        className="premium-input text-foreground focus-within:ring-primary field-sizing-content max-h-40 w-full max-w-full min-w-0 resize-none overflow-x-hidden overflow-y-auto px-5 py-3 break-words transition-all duration-300 ease-in-out focus-within:ring-2"
        maxLength={ALT_TEXT_MAX_LENGTH}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Describe this video for people who can't see it…"
        value={draft}
      />
    );
  }

  return (
    <div className="apple-panel w-full rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {hasSavedText ? "Edit alt text" : "Add alt text"}
          </p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            Describe this {mediaKindNoun(mimeType)} for people who can&apos;t
            see or hear it.
          </p>
        </div>
        <button
          aria-label="Close alt text editor"
          className="icon-btn-3d flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full p-0"
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <div className="apple-panel relative h-24 w-full shrink-0 overflow-hidden rounded-xl sm:h-24 sm:w-36">
          {renderPreview()}
        </div>
        {/* Actions live INSIDE the box, pinned bottom-right like Twitter's
            inline editors; the extra bottom padding keeps typed text clear
            of the overlay. */}
        <div className="relative min-h-24 flex-1">
          <Textarea
            aria-label="Alt text"
            autoFocus
            className="premium-input focus-visible:ring-primary min-h-24 w-full resize-none pb-11 text-sm transition-all duration-300 ease-in-out focus-visible:ring-2"
            maxLength={ALT_TEXT_MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write a description so everyone can follow along…"
            value={draft}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
            {atLimit ? (
              <span className="bg-destructive/10 text-destructive rounded-full px-2 py-1 text-[11px] font-medium tabular-nums">
                {ALT_TEXT_MAX_LENGTH} character limit
              </span>
            ) : null}
            {hasSavedText ? (
              <Button
                className="border-border/70 bg-background/85 hover:bg-background text-muted-foreground rounded-full border px-3 py-1 text-xs backdrop-blur-sm"
                onClick={handleRemove}
                size="sm"
                variant="ghost"
              >
                Remove
              </Button>
            ) : null}
            <Button
              className="rounded-full bg-gradient-to-b from-[#ff9500] to-[#e65500] px-3.5 py-1 text-xs text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(0,0,0,0.12)] hover:from-[#ff9f0a] hover:to-[#ea5b00]"
              onClick={handleSave}
              size="sm"
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AltTextPanel;
