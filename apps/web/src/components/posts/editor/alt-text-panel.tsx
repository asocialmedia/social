import { toast } from "@asm/ui/lib/gooey-toast";
import { Button } from "@asm/ui/shadui/button";
import zephImage from "@assets/zeph.png";
import { X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import type { Attachment } from "@/components/posts/editor/attachment-store";
import { ALT_TEXT_MAX_LENGTH } from "@/lib/media-upload-client";
import { cn } from "@/lib/utils";

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
  const [internalDraft, setInternalDraft] = useState(attachment.altText ?? "");
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  // Docked variant is controlled (parent flushes the draft on publish);
  // popover variant owns its draft until Done.
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

  const handleAutoAltText = async () => {
    if (!attachment.mediaId) {
      toast({
        description:
          "Please wait until the media finishes uploading to generate alt text.",
        title: "Media upload in progress",
      });
      return;
    }
    setIsAutoGenerating(true);
    try {
      const res = await fetch(`/api/media/${attachment.mediaId}/alt`);
      if (res.ok) {
        const data = (await res.json()) as {
          isProcessing?: boolean;
          suggestedAlt?: string;
        };
        if (data.suggestedAlt) {
          setDraft(data.suggestedAlt);
          toast({ title: "Alt text generated from media analysis" });
        } else if (data.isProcessing) {
          toast({
            description:
              "Media is still being transcribed and analyzed in the background. Please try again in a few moments.",
            title: "Analysis in progress",
          });
        } else {
          toast({
            description: "No spoken speech or text was detected in this media.",
            title: "No text detected",
          });
        }
      } else if (res.status === 401) {
        toast({
          description: "Your session expired. Please sign in again.",
          title: "Authentication required",
        });
      } else if (res.status === 404) {
        toast({
          description: "This media is no longer available.",
          title: "Media unavailable",
        });
      } else {
        toast({
          description:
            "Media is still being processed in the background. Please try again shortly.",
          title: "Analysis in progress",
        });
      }
    } catch {
      toast({
        description: "Network error while fetching media analysis.",
        title: "Could not generate alt text",
      });
    }
    setIsAutoGenerating(false);
  };

  const handleSave = () => {
    // Emptying the field and saving clears a previously stored description.
    onSave(fileName, draft.trim().slice(0, ALT_TEXT_MAX_LENGTH));
    // The docked gust variant stays open - it is part of the composer, not a
    // transient dialog.
    if (!compact) {
      onClose();
    }
  };

  if (compact) {
    // Mirrors the caption bar above it exactly: same premium-input surface,
    // same padding, same focus ring - a plain textarea carrying the caption
    // input's class set (the shadui Textarea chrome would fight it). The
    // draft rides to the media row on publish, so there is nothing to click.
    return (
      <div className="relative flex flex-col gap-1.5">
        {attachment.mediaId ? (
          <div className="flex justify-end">
            <button
              aria-label="Auto-generate alt text from speech and text detection"
              className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-linear-to-b from-amber-500/20 via-orange-500/15 to-orange-500/10 px-3 text-[11px] font-semibold text-orange-400 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.4),0_0_0_1px_rgba(234,88,12,0.6),0_1px_1px_rgba(255,255,255,0.2),0_2px_4px_rgba(0,0,0,0.15)] backdrop-blur-md transition-all duration-200 hover:scale-[1.02] hover:from-amber-500/30 hover:to-orange-500/20 hover:text-orange-300 active:translate-y-px disabled:opacity-50"
              disabled={isAutoGenerating}
              onClick={handleAutoAltText}
              type="button"
            >
              <Image
                alt=""
                className={cn(
                  "size-3.5 object-contain",
                  isAutoGenerating && "animate-spin"
                )}
                height={20}
                src={zephImage}
                width={20}
              />
              <span>{isAutoGenerating ? "Analyzing..." : "Auto Alt-Text"}</span>
            </button>
          </div>
        ) : null}
        <textarea
          aria-label="Alt text"
          className="premium-input text-foreground focus-within:ring-primary field-sizing-content max-h-40 w-full max-w-full min-w-0 resize-none overflow-x-hidden overflow-y-auto px-5 py-3 break-words transition-all duration-300 ease-in-out focus-within:ring-2"
          maxLength={ALT_TEXT_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Describe this video for people who can't see it…"
          value={draft}
        />
      </div>
    );
  }

  // Minimal inline bar styled like the gust editor's docked field: one
  // premium-input surface, the description inside, and dismiss + save
  // docked on the right.
  return (
    <div className="premium-input focus-within:ring-primary flex items-center gap-1.5 rounded-2xl py-2 pr-2 pl-5 transition-all duration-300 ease-in-out focus-within:ring-2">
      <textarea
        aria-label="Alt text"
        autoFocus
        className="placeholder:text-muted-foreground/70 field-sizing-content max-h-24 w-full resize-none border-0 bg-transparent p-0 text-sm outline-none"
        maxLength={ALT_TEXT_MAX_LENGTH}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Write a description so everyone can follow along…"
        value={draft}
      />
      {attachment.mediaId ? (
        <button
          aria-label="Auto-generate alt text from speech and text detection"
          className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-linear-to-b from-amber-500/20 via-orange-500/15 to-orange-500/10 px-3 text-xs font-semibold text-orange-400 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.4),0_0_0_1px_rgba(234,88,12,0.6),0_1px_1px_rgba(255,255,255,0.2),0_2px_4px_rgba(0,0,0,0.15)] backdrop-blur-md transition-all duration-200 hover:scale-[1.02] hover:from-amber-500/30 hover:to-orange-500/20 hover:text-orange-300 active:translate-y-px disabled:opacity-50"
          disabled={isAutoGenerating}
          onClick={handleAutoAltText}
          type="button"
        >
          <Image
            alt=""
            className={cn(
              "size-3.5 object-contain",
              isAutoGenerating && "animate-spin"
            )}
            height={20}
            src={zephImage}
            width={20}
          />
          <span>{isAutoGenerating ? "Analyzing..." : "Auto"}</span>
        </button>
      ) : null}
      <button
        aria-label="Dismiss alt text editor"
        className="text-muted-foreground flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-white/10"
        onClick={onClose}
        type="button"
      >
        <X className="size-4" />
      </button>
      <Button
        className="h-8 shrink-0 rounded-full bg-gradient-to-b from-[#ff9500] to-[#e65500] px-4 text-xs text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(0,0,0,0.12)] hover:from-[#ff9f0a] hover:to-[#ea5b00]"
        onClick={handleSave}
        size="sm"
      >
        Done
      </Button>
    </div>
  );
};

export default AltTextPanel;
