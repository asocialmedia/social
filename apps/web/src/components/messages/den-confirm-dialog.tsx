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

import { denConfirmCopy } from "@/lib/messages/den-permissions";

// Confirmation for every destructive den action: removing a member, leaving, and
// deleting the den outright.
//
// The same shape as MessageDeleteDialog, deliberately: one AlertDialog, one
// destructive button, one busy state. What differs is the copy, and that lives in
// `denConfirmCopy` so the two destructive paths cannot drift apart in tone and
// so the wording is assertable without rendering a dialog.
//
// The action is held for the async confirm (preventDefault) so a failure can
// surface as a toast and the dialog stays open until the request settles — the
// alternative, letting the dialog close optimistically, tells the reader a
// member was removed from a roster that never changed.
export function DenConfirmDialog({
  busy,
  kind,
  memberName,
  onConfirm,
  onOpenChange,
  open,
}: {
  busy: boolean;
  kind: "delete-den" | "leave-den" | "remove-member";
  memberName?: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const copy = denConfirmCopy({ kind, memberName });
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
            {busy ? "Working…" : copy.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
