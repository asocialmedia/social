"use client";

import type { TagWithCount, UserData } from "@asm/db";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { AtSign, Hash } from "lucide-react";
import { useCallback, useState } from "react";
import { MentionTagEditor } from "./mention-tag-editor";
import { TagEditor } from "./tag-editor";

interface PostMetaEditorDialogProps {
  mentions: UserData[];
  onClose: () => void;
  onMentionsChange?: (mentions: UserData[]) => void;
  onTagsChange?: (tags: TagWithCount[]) => void;
  open: boolean;
  postId: string;
  tags: TagWithCount[];
}

export function PostMetaEditorDialog({
  mentions,
  onClose,
  onMentionsChange,
  onTagsChange,
  open,
  postId,
  tags,
}: PostMetaEditorDialogProps) {
  const [activeTab, setActiveTab] = useState<"tags" | "mentions">("tags");

  const handleClose = useCallback(() => {
    setActiveTab("tags");
    onClose();
  }, [onClose]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        handleClose();
      }
    },
    [handleClose]
  );

  const handleSelectTags = useCallback(() => setActiveTab("tags"), []);
  const handleSelectMentions = useCallback(() => setActiveTab("mentions"), []);

  const handleTagsUpdate = useCallback(
    (updated: TagWithCount[]) => {
      onTagsChange?.(updated);
    },
    [onTagsChange]
  );

  const handleMentionsUpdate = useCallback(
    (updated: UserData[]) => {
      onMentionsChange?.(updated);
    },
    [onMentionsChange]
  );

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="apple-panel w-full max-w-[480px] gap-4 overflow-hidden p-0 sm:rounded-2xl">
        <div className="border-border/60 border-b px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2 font-semibold text-base">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
              <Hash className="h-3.5 w-3.5" />
            </div>
            Edit Tags &amp; Mentions
          </DialogTitle>
          <DialogDescription className="mt-1 text-muted-foreground text-xs">
            Manage tags and mentioned people for your post
          </DialogDescription>
        </div>

        <div className="px-5 pb-5">
          <div className="mb-3 flex gap-1 rounded-xl border border-border/60 bg-[hsl(var(--background-alt))] p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]">
            <button
              aria-pressed={activeTab === "tags"}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-medium text-sm transition-all duration-200 ${
                activeTab === "tags"
                  ? "bg-gradient-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
                  : "pill-3d-hover text-muted-foreground hover:text-foreground"
              }`}
              onClick={handleSelectTags}
              type="button"
            >
              <Hash className="h-3.5 w-3.5" />
              Tags
            </button>
            <button
              aria-pressed={activeTab === "mentions"}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-medium text-sm transition-all duration-200 ${
                activeTab === "mentions"
                  ? "bg-gradient-to-b from-[#7c5cff] to-[#5a3ae0] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(70,40,170,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
                  : "pill-3d-hover text-muted-foreground hover:text-foreground"
              }`}
              onClick={handleSelectMentions}
              type="button"
            >
              <AtSign className="h-3.5 w-3.5" />
              Mentions
            </button>
          </div>

          <div className={activeTab === "tags" ? "block" : "hidden"}>
            <TagEditor
              initialTags={tags.map((t) => t.name)}
              onCloseAction={handleClose}
              onTagsUpdateAction={handleTagsUpdate}
              postId={postId}
            />
          </div>
          <div className={activeTab === "mentions" ? "block" : "hidden"}>
            <MentionTagEditor
              initialMentions={mentions}
              onCloseAction={handleClose}
              onMentionsUpdateAction={handleMentionsUpdate}
              postId={postId}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
