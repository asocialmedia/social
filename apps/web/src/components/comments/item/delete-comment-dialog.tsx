import type { CommentData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { useCallback } from "react";

import { LoadingButton } from "@/components/auth/fields/loading-button";

import { useDeleteCommentMutation } from "../data/mutations";

interface DeleteCommentDialogProps {
  controller?: { pending: boolean; delete: () => Promise<boolean> };
  applyDeleted: (comment: CommentData) => void;
  comment: CommentData;
  onClose: () => void;
  open: boolean;
}

export default function DeleteCommentDialog({
  applyDeleted,
  comment,
  open,
  onClose,
  controller,
}: DeleteCommentDialogProps) {
  const mutation = useDeleteCommentMutation(applyDeleted);
  const pending = controller?.pending ?? mutation.isPending;

  const handleDelete = useCallback(async () => {
    if (controller) {
      if (await controller.delete()) {
        onClose();
      }
      return;
    }
    mutation.mutate(comment.id, { onSuccess: onClose });
  }, [comment.id, mutation, onClose, controller]);

  function handleOpenChange() {
    if (!pending) {
      onClose();
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Eddie?</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this Eddie? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <LoadingButton
            loading={pending}
            onClick={handleDelete}
            variant="destructive"
          >
            Delete
          </LoadingButton>
          <Button disabled={pending} onClick={onClose} variant="outline">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
