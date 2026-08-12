import type { PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Trash2 } from "lucide-react";
import { useCallback } from "react";
import LoadingButton from "@/components/auth/loading-button";
import { useDeletePostMutation } from "@/posts/mutations";

interface DeletePostDialogProps {
  onClose: () => void;
  open: boolean;
  post: PostData;
}

export default function DeletePostDialog({
  post,
  open,
  onClose,
}: DeletePostDialogProps) {
  const mutation = useDeletePostMutation();

  function handleOpenChange(isOpen: boolean) {
    if (!(isOpen && mutation.isPending)) {
      onClose();
    }
  }

  const handleDelete = useCallback(() => {
    mutation.mutate(post.id, { onSuccess: onClose });
  }, [mutation, onClose, post.id]);

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="apple-panel w-full max-w-[400px] gap-4 overflow-hidden p-0 sm:rounded-2xl">
        <div className="border-border/60 border-b px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2 font-semibold text-base">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-b from-[#f87171] to-[#dc2626] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(150,30,30,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
              <Trash2 className="h-3.5 w-3.5" />
            </div>
            Delete Post
          </DialogTitle>
          <DialogDescription className="mt-1 text-muted-foreground text-xs">
            This action cannot be undone.
          </DialogDescription>
        </div>

        <div className="px-5 pb-5">
          <p className="text-sm">
            Are you sure you want to delete this post? Once deleted, it&apos;s
            gone forever.
          </p>

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
              className="rounded-full bg-gradient-to-b from-[#f87171] to-[#dc2626] px-5 py-2 text-sm text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(150,30,30,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] hover:from-[#ef4444] hover:to-[#b91c1c]"
              loading={mutation.isPending}
              onClick={handleDelete}
            >
              Delete
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
