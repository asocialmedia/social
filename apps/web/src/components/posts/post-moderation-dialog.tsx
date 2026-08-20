import type { PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Switch } from "@asm/ui/shadui/switch";
import { ShieldCheck } from "lucide-react";
import type * as React from "react";
import { useCallback, useState } from "react";

import LoadingButton from "@/components/auth/loading-button";
import { useModeratePostMutation } from "@/posts/mutations";

interface PostModerationDialogProps {
  onClose: () => void;
  open: boolean;
  post: PostData;
}

// Moderation controls for admins and the post's author. Both flags are
// reversible: marking a post as moderated only hides its content behind a
// notice, and the explicit-content gate can always be lifted.
export default function PostModerationDialog({
  post,
  open,
  onClose,
}: PostModerationDialogProps) {
  const mutation = useModeratePostMutation();

  const [moderated, setModerated] = useState(post.moderated);
  const [explicitContent, setExplicitContent] = useState(post.explicitContent);
  // Tracks the last open state so the switches reset to the post's current DB
  // state every time the dialog opens. useState only reads the initial prop at
  // mount, so without this the toggles can show stale values (e.g. "moderated"
  // reads as off right after a moderation refetch) and the user would have no
  // way to flip moderation back off. Adjusting state during render is the
  // React-recommended way to reset on a prop transition without an effect.
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setModerated(post.moderated);
      setExplicitContent(post.explicitContent);
    }
  }

  const isDirty =
    moderated !== post.moderated || explicitContent !== post.explicitContent;

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!(isOpen && mutation.isPending)) {
        onClose();
      }
    },
    [mutation.isPending, onClose]
  );

  const handleApply = useCallback(() => {
    mutation.mutate(
      { changes: { explicitContent, moderated }, postId: post.id },
      { onSuccess: onClose }
    );
  }, [explicitContent, moderated, mutation, onClose, post.id]);

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="apple-panel w-full max-w-[420px] gap-4 overflow-hidden p-0 sm:rounded-2xl"
        onClick={handleContentClick}
      >
        <div className="border-border/60 border-b px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-b from-[#fbbf24] to-[#f97316] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(146,64,14,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
              <ShieldCheck className="h-3.5 w-3.5" />
            </div>
            Moderation
          </DialogTitle>
          <DialogDescription className="text-muted-foreground mt-1 text-xs">
            These flags are reversible. Nothing is ever deleted from the
            database.
          </DialogDescription>
        </div>

        <div className="flex flex-col px-5 pb-5">
          <div className="flex items-start justify-between gap-4 py-2">
            <div>
              <p className="text-sm font-semibold">Mark as moderated</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Hides the content behind a &quot;This post has been
                moderated&quot; notice.
              </p>
            </div>
            <Switch
              aria-label="Mark as moderated"
              checked={moderated}
              onCheckedChange={setModerated}
            />
          </div>

          <div className="border-border/60 flex items-start justify-between gap-4 border-t py-2">
            <div>
              <p className="text-sm font-semibold">Flag explicit content</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Blurs the media until a viewer taps Continue.
              </p>
            </div>
            <Switch
              aria-label="Flag explicit content"
              checked={explicitContent}
              onCheckedChange={setExplicitContent}
            />
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button
              className="pill-3d-hover text-muted-foreground"
              disabled={mutation.isPending}
              onClick={onClose}
              variant="ghost"
            >
              Cancel
            </Button>
            <LoadingButton
              className="pill-3d-hover rounded-full px-5 py-2 text-sm"
              disabled={!isDirty}
              loading={mutation.isPending}
              onClick={handleApply}
            >
              Apply
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
