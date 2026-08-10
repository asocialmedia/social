import type { UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import LoadingButton from "@/components/auth/loading-button";
import { useUnfollowUserMutation } from "@/hooks/user-mutations";

interface UnfollowUserDialogProps {
  onClose: () => void;
  open: boolean;
  user: UserData;
}

export default function UnfollowUserDialog({
  user,
  open,
  onClose,
}: UnfollowUserDialogProps) {
  const queryClient = useQueryClient();
  const mutation = useUnfollowUserMutation();
  const [isUnfollowing, setIsUnfollowing] = useState(false);

  function handleOpenChange(isOpen: boolean) {
    if (!(isOpen && (mutation.isPending || isUnfollowing))) {
      onClose();
    }
  }

  const handleUnfollow = () => {
    setIsUnfollowing(true);

    // Optimistic update
    queryClient.setQueryData<UserData[]>(["followed-users"], (old) =>
      (old || []).filter((u) => u.id !== user.id)
    );

    mutation.mutate(user.id, {
      onSuccess: () => {
        // The optimistic update is already done, so we just close the dialog
        onClose();
      },
      onError: () => {
        // Revert the optimistic update if there's an error
        queryClient.invalidateQueries({ queryKey: ["followed-users"] });
      },
      onSettled: () => {
        setIsUnfollowing(false);
      },
    });

    // Close the dialog immediately for a snappier feel
    onClose();
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unfollow User</DialogTitle>
          <DialogDescription>
            Are you sure you want to unfollow {user.displayName}? You can always
            follow them again later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <LoadingButton
            loading={isUnfollowing}
            onClick={handleUnfollow}
            variant="destructive"
          >
            Unfollow
          </LoadingButton>
          <Button disabled={isUnfollowing} onClick={onClose} variant="outline">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
