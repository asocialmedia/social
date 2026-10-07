"use client";

import { DEN_BAN_REASON_MAX } from "@asm/db/messages/dens";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Input } from "@asm/ui/shadui/input";
import { Ban } from "lucide-react";
import { useState } from "react";

import {
  DEN_BAN_REASON_LABEL,
  denBanConfirmCopy,
} from "@/lib/messages/den-ban-copy";

// Confirmation for banning somebody out of a den.
//
// Its own component rather than one more case in `DenConfirmDialog`, for one reason:
// this is the only den confirmation with a field in it. A shared component would have
// to grow a `reason` prop that every other case ignores, and a reason input rendered
// for a case that has no reason is a control that does nothing.
//
// Lifting a ban does NOT come here. It has no field, it is the inverse of this
// decision rather than a variant of it, and it sits beside Remove in the generic
// dialog - where the reader already looks for the other two actions about a person.
//
// `Dialog` and not `AlertDialog`, and this is deliberate. A ban is something a manager
// may reasonably want to undo in the same sitting, so it must not be dressed as a
// decision that ends the conversation; there is no second confirmation standing between
// a manager and the thing they are trying to do.
export function DenBanDialog({
  ban,
  busy,
  onConfirm,
  onOpenChange,
  open,
}: {
  // Only what the copy needs, rather than a whole `DenMember`: this dialog renders a
  // name and nothing else about the person, so accepting a wider type would let a
  // caller believe it had shown the rest.
  ban: { displayName?: string | null; username?: string | null };
  busy: boolean;
  onConfirm: (reason: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const copy = denBanConfirmCopy(ban.displayName ?? ban.username ?? null);
  // The text is state rather than derived, and it is reset by REMOUNTING rather than by
  // an effect: the panel unmounts this dialog whenever nobody is being banned, so
  // banning somebody new mounts it fresh, and the reset lands before the first paint
  // rather than after it. An effect clearing this on open would render the previous
  // person's reason once first - which is a note about somebody else, under the wrong
  // name, waiting to be confirmed.
  const [reason, setReason] = useState("");

  // The reason is optional and the label says who can read it, because a manager
  // writing a note to the next manager needs to know it is one, and somebody who
  // assumed the banned person reads it would write something else entirely. The
  // placeholder is an instruction rather than a value - a pre-filled sentence is a
  // sentence somebody would send.
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-h-[calc(100dvh-4rem)] sm:w-full">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <label
            className="text-muted-foreground text-xs"
            htmlFor="den-ban-reason"
          >
            {DEN_BAN_REASON_LABEL}
          </label>
          <Input
            className="min-h-11 w-full rounded-xl! text-base sm:text-sm"
            id="den-ban-reason"
            // The server's own number, not a literal. `DEN_BAN_REASON_MAX` moved to
            // `@asm/db/messages/dens` for this: the cap is a rule, and a rule written
            // twice is a rule that will be wrong in one of the two places. A textarea
            // rejecting input the server would have accepted - or accepting input the
            // server silently truncates - is the same bug with the sign flipped.
            maxLength={DEN_BAN_REASON_MAX}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            placeholder="Anything the next owner should know"
            value={reason}
          />
        </div>
        <DialogFooter>
          <Button
            className="min-h-11 rounded-2xl! px-4 text-sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              onOpenChange(false);
            }}
            type="button"
          >
            Cancel
          </Button>
          <Button
            // A ban takes somebody out AND locks the door, so it wears the
            // destructive treatment.
            className="min-h-11 rounded-2xl! px-4 text-sm"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              onConfirm(reason);
            }}
            type="button"
          >
            <Ban aria-hidden className="size-4" />
            {busy ? "Working…" : copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
