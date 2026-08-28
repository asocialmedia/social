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

import { LoadingButton } from "@/components/auth/loading-button";

import { useDeleteCommentMutation } from "./mutations";

interface DeleteCommentDialogProps {
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
}: DeleteCommentDialogProps) {
  const mutation = useDeleteCommentMutation(applyDeleted);

  const handleDelete = useCallback(() => {
    mutation.mutate(comment.id, { onSuccess: onClose });
  }, [comment.id, mutation, onClose]);

  function handleOpenChange(isOpen: boolean) {
    if (!(isOpen && mutation.isPending)) {
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
            loading={mutation.isPending}
            onClick={handleDelete}
            variant="destructive"
          >
            Delete
          </LoadingButton>
          <Button
            disabled={mutation.isPending}
            onClick={onClose}
            variant="outline"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
