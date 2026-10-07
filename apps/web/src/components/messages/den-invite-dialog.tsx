"use client";

import type { DenInviteDurationDays } from "@asm/db/messages/dens";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useState } from "react";

import { denInviteCountdown, denInviteUrl } from "@/lib/messages/den-invite";
import { cn } from "@/lib/utils";

// The picker's options, in display order: the three presets, then the absence
// of an expiry. A mirror of the server's `DEN_INVITE_DURATION_DAYS` plus its
// null, kept as a tuple so the chips render in this order and no other.
const INVITE_DURATION_CHOICES = [1, 7, 30, null] as const;

// The default when the den has never had an expiry picked: a week, which is
// what a shared link is for. The den's own last choice wins when it has one.
const DEFAULT_DURATION_DAYS: DenInviteDurationDays = 7;

// What a generation hands back: the freshly minted link, for the input to show
// immediately, before any refetch confirms it.
export interface DenInviteMinted {
  inviteCode: string;
  inviteExpiresAt: Date | null;
}

// The den's invite sheet: the link, how long it lives, and the one action that
// changes either.
//
// Its own component rather than one more block in the panel, for the same reason
// the ban dialog is: this is the one den surface with its own working state (the
// freshly minted link shown before the refetch lands), and a panel would have to
// hold that state for a surface most members never open.
//
// The link rides in a read-only input rather than as text on the page, because
// the input is the affordance that selects it: focus selects the whole link, and
// the copy button beside it is where the hand already is. The expiry chips sit
// ABOVE the link on purpose - choosing how long the next link lasts precedes
// reading the current one - and "Generate new link" is the only writer. Nothing
// here mints implicitly: opening the dialog shares the door, it does not replace
// it. Generating keeps the sheet open so the manager can copy the link they just
// made; the fresh link replaces the input's value in place.
export function DenInviteDialog({
  busy,
  inviteCode,
  inviteDurationDays,
  inviteExpiresAt,
  now,
  onGenerate,
  onOpenChange,
  open,
}: {
  busy: boolean;
  inviteCode: string;
  // The preset the den last minted with, which seeds the selector. Null means
  // the den's current link never expires - and that a previous picker said so.
  inviteDurationDays: number | null;
  inviteExpiresAt: Date | null;
  // The moment the expiry is judged against, handed in rather than read from the
  // wall clock so this component stays a pure function of its props between
  // renders.
  now: Date;
  onGenerate: (
    durationDays: DenInviteDurationDays | null
  ) => Promise<DenInviteMinted | null>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const seeded =
    inviteDurationDays === 1 ||
    inviteDurationDays === 7 ||
    inviteDurationDays === 30
      ? inviteDurationDays
      : DEFAULT_DURATION_DAYS;
  const [selected, setSelected] = useState<DenInviteDurationDays | null>(
    seeded
  );
  // The link being shown, which diverges from `inviteCode` for one render
  // window: between a successful mint and the refetch that confirms it. Held as
  // state so the manager ALWAYS sees the code they are about to copy, even when
  // the query cache has not caught up.
  const [shown, setShown] = useState<DenInviteMinted>({
    inviteCode,
    inviteExpiresAt,
  });
  // One-shot feedback on the copy button itself, so the confirmation lives
  // where the press happened rather than solely in a toast that fades.
  const [copied, setCopied] = useState(false);

  const expired =
    shown.inviteExpiresAt !== null && shown.inviteExpiresAt <= now;
  const countdown = denInviteCountdown(shown.inviteExpiresAt, now);

  const copy = async () => {
    const link = denInviteUrl(window.location.origin, shown.inviteCode);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // The clipboard can refuse (permissions, HTTP context). Falling back to
      // leaving the link selected in the input keeps the action honest: the
      // manager can still copy it by hand, and nothing pretends to have worked.
      setCopied(false);
    }
  };

  const generate = async () => {
    const minted = await onGenerate(selected);
    if (minted) {
      setShown(minted);
      // The new link's countdown is judged from the same `now` until the next
      // refetch: a moments-old link is not measurably different from a
      // zero-seconds-old one, and the countdown label updates on its own once
      // the panel's payload lands.
      setCopied(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite another member</DialogTitle>
          <DialogDescription>
            Anyone with this link can join, whether or not they follow anybody
            in here. Banned accounts are still refused.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">Link expires</span>
            <fieldset
              aria-label="Link expiry"
              className="flex flex-wrap gap-1.5 border-0 p-0"
            >
              {INVITE_DURATION_CHOICES.map((days) => (
                <button
                  aria-pressed={selected === days}
                  className={cn(
                    "chip-3d cursor-pointer rounded-full text-xs",
                    selected === days && "border-primary/60 bg-primary/15"
                  )}
                  key={days === null ? "never" : days}
                  onClick={() => {
                    setSelected(days);
                  }}
                  type="button"
                >
                  {days === null
                    ? "No expiry"
                    : `${days} day${days === 1 ? "" : "s"}`}
                </button>
              ))}
            </fieldset>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-muted-foreground text-xs"
              htmlFor="den-invite-link"
            >
              Invite link
            </label>
            <div className="relative">
              <input
                aria-label="Invite link"
                className="premium-input w-full pr-10! text-xs"
                id="den-invite-link"
                onFocus={(event) => {
                  // The input is read-only, so focus is already the selection
                  // gesture; selecting the whole link makes Ctrl-C work from
                  // wherever the focus landed.
                  event.currentTarget.select();
                }}
                readOnly
                value={denInviteUrl(window.location.origin, shown.inviteCode)}
              />
              <button
                aria-label={copied ? "Copied" : "Copy invite link"}
                className="icon-btn-3d absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center"
                onClick={() => {
                  void copy();
                }}
                title="Copy invite link"
                type="button"
              >
                {copied ? (
                  <Check className="text-primary size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </div>
            <p
              className={cn(
                "text-xs tabular-nums",
                expired ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {expired
                ? "This link has expired. Generate a new one to keep sharing access."
                : countdown}
            </p>
          </div>
        </div>

        <DialogFooter>
          <button
            className="text-muted-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              onOpenChange(false);
            }}
            type="button"
          >
            Close
          </button>
          <button
            className="btn-3d inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              void generate();
            }}
            type="button"
          >
            <RefreshCw aria-hidden className="size-4" />
            {busy ? "Creating…" : "Generate new link"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
