"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";

import {
  ACCESS_ENDED_DESCRIPTION,
  ACCESS_ENDED_DISMISS_LABEL,
  ACCESS_ENDED_MESSAGE,
} from "@/lib/messages/access-ended";

// The popup a member gets when the server removes them from a den.
//
// A dialog, and this used to be a line sitting directly above the composer with a
// "Fair enough :(" button beside it. Two problems with that: it was the quietest
// possible place to put news that has already happened to somebody, and it left the
// reader looking at a dead input with no idea why. The input now says why in its own
// placeholder, which is the durable half - it is there for as long as they are out -
// and this is the announcement, which is why it is a dialog.
//
// Why the dialog carries the DESCRIPTION and the composer carries the reason: the
// dialog is transient and can afford a sentence, and the placeholder cannot.
//
// Deliberately the same title as the self-leave dialog in `message-thread.tsx`,
// because both say the same fact; only the body differs, and it differs for the same
// reason the two events do - leaving is a choice and a kick is not.
//
// `Dialog` and not `AlertDialog`: this is not asking for a decision. There is nothing
// to confirm and nowhere to navigate to, so it must not present itself as a choice
// with a destructive-looking primary action.
export function MessageAccessEndedDialog({
  onDismiss,
  open,
}: {
  onDismiss: () => void;
  open: boolean;
}) {
  return (
    <Dialog onOpenChange={(next) => !next && onDismiss()} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ACCESS_ENDED_MESSAGE}</DialogTitle>
          <DialogDescription>{ACCESS_ENDED_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            className="btn-3d inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium"
            onClick={onDismiss}
            type="button"
          >
            {ACCESS_ENDED_DISMISS_LABEL}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
