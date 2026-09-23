"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@asm/ui/shadui/alert-dialog";

import type { MessageDeleteCopy } from "@/lib/messages/message-delete";

// Confirmation gate for every message-delete action. The thread decides what is
// being deleted (one message, a selection, or for everyone) and supplies the
// matching copy; this component only owns the destructive-action presentation
// and the busy state while the request is in flight.
//
// The action is held for the async confirm (preventDefault) so a failure can
// surface as a toast and the dialog stays open until the delete settles.
export function MessageDeleteDialog({
  busy,
  copy,
  onConfirm,
  onOpenChange,
  open,
}: {
  busy: boolean;
  copy: MessageDeleteCopy;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent aria-busy={busy}>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {busy ? "Deleting…" : copy.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
