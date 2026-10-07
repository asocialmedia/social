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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useState } from "react";

import { denInviteCountdown, denInviteUrl } from "@/lib/messages/den-invite";
import { cn } from "@/lib/utils";

// The picker's options, in display order: the three presets, then the absence
// of an expiry. A mirror of the server's `DEN_INVITE_DURATION_DAYS` plus its
// null, kept as a tuple so the chips render in this order and no other.
const INVITE_DURATION_CHOICES = [1, 7, 30, null] as const;

// The default when the den has never had an expiry picked: a week, which is
// what a shared link or code is for. The den's own last choice wins when it has one.
const DEFAULT_DURATION_DAYS: DenInviteDurationDays = 7;

// What a link generation hands back: the freshly minted link, for the input to show
// immediately, before any refetch confirms it.
export interface DenInviteMinted {
  inviteCode: string;
  inviteExpiresAt: Date | null;
}

// What a code generation hands back: the freshly minted short code, for the input
// to show immediately, before any refetch confirms it.
export interface DenInviteShortCodeMinted {
  inviteShortCode: string;
  inviteShortCodeExpiresAt: Date | null;
}

// One door of the sheet, as its input shows it: the value being shared and the
// expiry it was minted with. The expiry presets are NOT part of a door - they
// are the manager's next choice, seeded from the den's last one.
export interface DenInviteDoorState {
  code: string | null;
  expiresAt: Date | null;
}

// The state a CLOSED sheet re-seeds to, or null while it is open.
//
// The dialog can stay mounted for the whole time the panel is on screen, and
// its props move on every refetch - most importantly after ANOTHER manager
// rotates a door. Without a re-seed, the second manager to open the sheet reads
// and copies a door that no longer works: the shown values are stale input
// state, not stale props, so nothing else corrects them.
//
// The `open` gate is the other half of the contract. While the sheet is open
// the shown values belong to the manager: a refetch that lands mid-mint must
// not visually replace the value the mint just produced. So this answers "what
// should I show right now" with null when the sheet is open, and the component
// keeps whatever its user is looking at.
export function reseededInviteDoor(
  open: boolean,
  input: {
    code: string | null;
    expiresAt: Date | null;
  }
): DenInviteDoorState | null {
  if (open) {
    return null;
  }
  return { code: input.code, expiresAt: input.expiresAt };
}

// The expiry preset a closed sheet's picker re-seeds to: the den's last choice
// when that choice is one of the presets, and the default when it is not.
// Same shape as the picker's own first seed, so a door that was rotated by
// somebody else also rotates the picker back to what the den actually asked
// for. Null while the sheet is open, for the same reason the doors are.
export function reseededInviteDuration(
  open: boolean,
  lastPicked: number | null
): DenInviteDurationDays | null {
  if (open) {
    return null;
  }
  if (lastPicked === 1 || lastPicked === 7 || lastPicked === 30) {
    return lastPicked;
  }
  return DEFAULT_DURATION_DAYS;
}

// The den's invite sheet: the link and short code doors, how long each lives, and
// the actions that change either independently.
//
// Tabs split "Link" and "Code" so each door can be shared or rotated on its own
// preset without interfering with the other. Link remains the default tab to preserve
// the established flow.
//
// The sheet can stay MOUNTED while its props move underneath it - the panel keeps
// it alive whenever either door exists, and the detail payload the props come from
// refetches after every mutation, including one made by ANOTHER manager in a
// different tab. So while the sheet is CLOSED its shown doors and picked presets
// follow `reseededInviteDoor`/`reseededInviteDuration` back to the live props; a
// manager who reopens the sheet reads the doors that are live now, not the ones
// that were live when they first opened it. While it is OPEN the state is the
// user's - an in-flight mint must not be visually replaced by a refetch that
// races it.

// The code writer's label. Busy names the flight, a live code names the
// rotation it invites, and the first mint is a plain "generate".
function codeButtonLabel(busy: boolean, code: string | null): string {
  if (busy) {
    return "Creating…";
  }
  return code ? "Generate new code" : "Generate code";
}

export function DenInviteDialog({
  busy,
  codeBusy = false,
  inviteCode,
  inviteDurationDays,
  inviteExpiresAt,
  inviteShortCode = null,
  inviteShortCodeDurationDays = null,
  inviteShortCodeExpiresAt = null,
  linkBusy = false,
  now,
  onGenerate,
  onGenerateCode,
  onOpenChange,
  open,
}: {
  // The sheet-gate: true while ANY mutation in the panel is in flight, so a
  // roster-affecting operation can't run under the sheet. The per-door flags
  // below decide which writer shows its own spinner.
  busy: boolean;
  // True while THIS door's mint is in flight. Separate from `busy` so a code
  // mint doesn't disable the link writer (or vice versa) - each door has its
  // own rotation budget, and the two are independent.
  codeBusy?: boolean;
  linkBusy?: boolean;
  inviteCode: string | null;
  // The preset the den last minted the link with, which seeds the link selector.
  inviteDurationDays: number | null;
  inviteExpiresAt: Date | null;
  inviteShortCode?: string | null;
  // The preset the den last minted the code with, which seeds the code selector.
  inviteShortCodeDurationDays?: number | null;
  inviteShortCodeExpiresAt?: Date | null;
  // The moment the expiry is judged against, handed in rather than read from the
  // wall clock so this component stays a pure function of its props between renders.
  now: Date;
  onGenerate: (
    durationDays: DenInviteDurationDays | null
  ) => Promise<DenInviteMinted | null>;
  onGenerateCode: (
    durationDays: DenInviteDurationDays | null
  ) => Promise<DenInviteShortCodeMinted | null>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [tab, setTab] = useState<"link" | "code">("link");

  // Each door's shown value is DERIVED, not held: the props are the live truth
  // (and they move on every refetch, including after ANOTHER manager rotates a
  // door in a different tab), and this state holds only what the manager has
  // minted in THIS sheet session that the refetch has not confirmed yet. When
  // the sheet closes the overrides are dropped - there is nothing left to show
  // ahead of the refetch once nobody is looking - so a reopened sheet always
  // reads the doors that are live now.
  const [linkOverride, setLinkOverride] = useState<DenInviteDoorState | null>(
    null
  );
  const [codeOverride, setCodeOverride] = useState<DenInviteDoorState | null>(
    null
  );

  // The picker's preset is genuine state while the sheet is open (the manager
  // is choosing what the NEXT mint lives for), and follows the props while the
  // sheet is closed so a reopen re-seeds from the den's latest choice.
  // `reseededInviteDuration` answers null while open, which distinguishes "the
  // manager is picking" from "nothing is picked in this session".
  const [pickedLink, setPickedLink] = useState<DenInviteDurationDays | null>(
    () => reseededInviteDuration(false, inviteDurationDays)
  );
  const [pickedLinkOpen, setPickedLinkOpen] = useState(false);
  const [pickedCode, setPickedCode] = useState<DenInviteDurationDays | null>(
    () => reseededInviteDuration(false, inviteShortCodeDurationDays)
  );
  const [pickedCodeOpen, setPickedCodeOpen] = useState(false);
  const linkDurationSeed = reseededInviteDuration(false, inviteDurationDays);
  const codeDurationSeed = reseededInviteDuration(
    false,
    inviteShortCodeDurationDays
  );
  const pickedLinkShown = pickedLinkOpen ? pickedLink : linkDurationSeed;
  const selectedLinkDuration = open ? pickedLinkShown : linkDurationSeed;
  const pickedCodeShown = pickedCodeOpen ? pickedCode : codeDurationSeed;
  const selectedCodeDuration = open ? pickedCodeShown : codeDurationSeed;
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const shownLink: DenInviteDoorState = open
    ? (linkOverride ?? {
        code: inviteCode,
        expiresAt: inviteExpiresAt,
      })
    : {
        code: inviteCode,
        expiresAt: inviteExpiresAt,
      };
  const shownCode: DenInviteDoorState = open
    ? (codeOverride ?? {
        code: inviteShortCode,
        expiresAt: inviteShortCodeExpiresAt,
      })
    : {
        code: inviteShortCode,
        expiresAt: inviteShortCodeExpiresAt,
      };

  const linkExpired =
    shownLink.expiresAt !== null && shownLink.expiresAt <= now;
  const linkCountdown = denInviteCountdown(shownLink.expiresAt, now);

  const codeExpired =
    shownCode.expiresAt !== null && shownCode.expiresAt <= now;
  const codeCountdown = denInviteCountdown(shownCode.expiresAt, now);

  const copyLink = async () => {
    if (!shownLink.code) {
      return;
    }
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const link = denInviteUrl(origin, shownLink.code);
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => {
        setCopiedLink(false);
      }, 2000);
    } catch {
      setCopiedLink(false);
    }
  };

  const copyCode = async () => {
    if (!shownCode.code) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shownCode.code);
      setCopiedCode(true);
      setTimeout(() => {
        setCopiedCode(false);
      }, 2000);
    } catch {
      setCopiedCode(false);
    }
  };

  const generateLink = async () => {
    const minted = await onGenerate(selectedLinkDuration);
    if (minted) {
      setLinkOverride({
        code: minted.inviteCode,
        expiresAt: minted.inviteExpiresAt,
      });
      setPickedLinkOpen(true);
      setCopiedLink(false);
    }
  };

  const generateCode = async () => {
    const minted = await onGenerateCode(selectedCodeDuration);
    if (minted) {
      setCodeOverride({
        code: minted.inviteShortCode,
        expiresAt: minted.inviteShortCodeExpiresAt,
      });
      setPickedCodeOpen(true);
      setCopiedCode(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite another member</DialogTitle>
          <DialogDescription>
            {tab === "link"
              ? "Anyone with this link can join, whether or not they follow anybody in here. Banned accounts are still refused."
              : "Anyone with this code can join, whether or not they follow anybody in here. Banned accounts are still refused."}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          className="w-full"
          onValueChange={(val) => setTab(val as "link" | "code")}
          value={tab}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="link">Link</TabsTrigger>
            <TabsTrigger value="code">Code</TabsTrigger>
          </TabsList>

          <TabsContent className="flex flex-col gap-4 pt-2" value="link">
            {shownLink.code ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground text-xs">
                    Link expires
                  </span>
                  <fieldset
                    aria-label="Link expiry"
                    className="flex flex-wrap gap-1.5 border-0 p-0"
                  >
                    {INVITE_DURATION_CHOICES.map((days) => (
                      <button
                        aria-pressed={selectedLinkDuration === days}
                        className={cn(
                          "chip-3d cursor-pointer rounded-full text-xs",
                          selectedLinkDuration === days &&
                            "border-primary/60 bg-primary/15"
                        )}
                        key={days === null ? "never" : days}
                        onClick={() => {
                          setPickedLink(days);
                          setPickedLinkOpen(true);
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
                        event.currentTarget.select();
                      }}
                      readOnly
                      value={denInviteUrl(
                        typeof window === "undefined"
                          ? ""
                          : window.location.origin,
                        shownLink.code
                      )}
                    />
                    <button
                      aria-label={copiedLink ? "Copied" : "Copy invite link"}
                      className="icon-btn-3d absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center"
                      disabled={busy || linkBusy}
                      onClick={() => {
                        void copyLink();
                      }}
                      title="Copy invite link"
                      type="button"
                    >
                      {copiedLink ? (
                        <Check className="text-primary size-3.5" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  </div>
                  <p
                    className={cn(
                      "text-xs tabular-nums",
                      linkExpired ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {linkExpired
                      ? "This link has expired. Generate a new one to keep sharing access."
                      : linkCountdown}
                  </p>
                </div>
              </>
            ) : (
              <div className="surface-3d flex flex-col items-center justify-center gap-3 rounded-xl p-5 text-center">
                <p className="text-muted-foreground text-xs">
                  No link yet — generate one to share with others.
                </p>
                <button
                  className="btn-3d inline-flex h-8 items-center justify-center gap-1.5 rounded-lg! px-3 text-xs font-medium disabled:opacity-50"
                  disabled={busy || linkBusy}
                  onClick={() => {
                    void generateLink();
                  }}
                  type="button"
                >
                  <RefreshCw
                    aria-hidden
                    className={linkBusy ? "size-3.5 animate-spin" : "size-3.5"}
                  />
                  {linkBusy ? "Creating…" : "Generate link"}
                </button>
              </div>
            )}
          </TabsContent>

          <TabsContent className="flex flex-col gap-4 pt-2" value="code">
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">
                Code expires
              </span>
              <fieldset
                aria-label="Code expiry"
                className="flex flex-wrap gap-1.5 border-0 p-0"
              >
                {INVITE_DURATION_CHOICES.map((days) => (
                  <button
                    aria-pressed={selectedCodeDuration === days}
                    className={cn(
                      "chip-3d cursor-pointer rounded-full text-xs",
                      selectedCodeDuration === days &&
                        "border-primary/60 bg-primary/15"
                    )}
                    key={days === null ? "never" : days}
                    onClick={() => {
                      setPickedCode(days);
                      setPickedCodeOpen(true);
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

            {shownCode.code ? (
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-muted-foreground text-xs"
                  htmlFor="den-invite-code"
                >
                  Invite code
                </label>
                <div className="relative">
                  <input
                    aria-label="Invite code"
                    className="premium-input w-full pr-10! text-center font-mono text-base font-semibold tracking-[0.3em]"
                    id="den-invite-code"
                    onFocus={(event) => {
                      event.currentTarget.select();
                    }}
                    readOnly
                    value={shownCode.code}
                  />
                  <button
                    aria-label={copiedCode ? "Copied" : "Copy invite code"}
                    className="icon-btn-3d absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center"
                    disabled={busy || codeBusy}
                    onClick={() => {
                      void copyCode();
                    }}
                    title="Copy invite code"
                    type="button"
                  >
                    {copiedCode ? (
                      <Check className="text-primary size-3.5" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                </div>
                <p
                  className={cn(
                    "text-xs tabular-nums",
                    codeExpired ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {codeExpired
                    ? "This code has expired. Generate a new one to keep sharing access."
                    : codeCountdown}
                </p>
              </div>
            ) : (
              <div className="surface-3d flex flex-col items-center justify-center gap-3 rounded-xl p-5 text-center">
                <p className="text-muted-foreground text-xs">
                  No code yet — generate one to share with others.
                </p>
                <button
                  className="btn-3d inline-flex h-8 items-center justify-center gap-1.5 rounded-lg! px-3 text-xs font-medium disabled:opacity-50"
                  disabled={busy || codeBusy}
                  onClick={() => {
                    void generateCode();
                  }}
                  type="button"
                >
                  <RefreshCw
                    aria-hidden
                    className={codeBusy ? "size-3.5 animate-spin" : "size-3.5"}
                  />
                  {codeBusy ? "Creating…" : "Generate code"}
                </button>
              </div>
            )}
          </TabsContent>
        </Tabs>

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
          {tab === "link" && (
            <button
              className="btn-3d inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium disabled:opacity-50"
              disabled={busy || linkBusy}
              onClick={() => {
                void generateLink();
              }}
              type="button"
            >
              <RefreshCw
                aria-hidden
                className={linkBusy ? "size-4 animate-spin" : "size-4"}
              />
              {linkBusy ? "Creating…" : "Generate new link"}
            </button>
          )}
          {tab === "code" && (
            <button
              className="btn-3d inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium disabled:opacity-50"
              disabled={busy || codeBusy}
              onClick={() => {
                void generateCode();
              }}
              type="button"
            >
              <RefreshCw
                aria-hidden
                className={codeBusy ? "size-4 animate-spin" : "size-4"}
              />
              {codeButtonLabel(codeBusy, shownCode.code)}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
