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

// Confirmation for every den action a person has to agree to: removing a member,
// leaving, handing the den to somebody else, and deleting it outright.
//
// The same shape as MessageDeleteDialog, deliberately: one AlertDialog, one
// confirm button, one busy state. What differs is the copy, and that lives in
// `denConfirmCopy` so the four paths cannot drift apart in tone and so the wording
// is assertable without rendering a dialog.
//
// The action is held for the async confirm (preventDefault) so a failure can
// surface as a toast and the dialog stays open until the request settles — the
// alternative, letting the dialog close optimistically, tells the reader a member
// was removed from a roster that never changed.
export function DenConfirmDialog({
  busy,
  kind,
  memberName,
  onConfirm,
  onOpenChange,
  open,
}: {
  busy: boolean;
  kind:
    | "delete-den"
    | "leave-den"
    | "remove-member"
    | "transfer-ownership"
    | "unban-member";
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
            // Destructive only where the action takes something away. An unban hands
            // somebody the right to come back, so it wears the ordinary button: the
            // red one would say this is a punishment when it is the opposite.
            className={
              kind === "unban-member"
                ? undefined
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            }
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
