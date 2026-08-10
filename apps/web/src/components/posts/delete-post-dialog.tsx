import type { PostData } from "@asm/db";
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Post</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this post? This action cannot be
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
