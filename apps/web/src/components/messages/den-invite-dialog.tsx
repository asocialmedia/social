"use client";

import type { DenInviteDurationDays } from "@asm/db/messages/dens";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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

export function DenInviteDialog(
  props: Parameters<typeof DenInviteDialogSession>[0]
) {
  return props.open ? <DenInviteDialogSession {...props} /> : null;
}

function DenInviteDialogSession({
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
  const [creatingCode, setCreatingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeRequestPending = useRef(false);
  const autoCodeAttempted = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
  const generatingCode = codeBusy || creatingCode;

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

  const generateCode = useCallback(async () => {
    if (codeRequestPending.current) {
      return;
    }
    codeRequestPending.current = true;
    setCreatingCode(true);
    setCodeError(null);
    try {
      const minted = await onGenerateCode(selectedCodeDuration);
      if (!mounted.current) {
        return;
      }
      if (minted) {
        setCodeOverride({
          code: minted.inviteShortCode,
          expiresAt: minted.inviteShortCodeExpiresAt,
        });
        setPickedCodeOpen(true);
        setCopiedCode(false);
      } else {
        setCodeError("Couldn't create an invite code. Try again.");
      }
    } catch {
      if (mounted.current) {
        setCodeError("Couldn't create an invite code. Try again.");
      }
    }
    codeRequestPending.current = false;
    if (mounted.current) {
      setCreatingCode(false);
    }
  }, [onGenerateCode, selectedCodeDuration]);

  useEffect(() => {
    if (
      tab !== "code" ||
      busy ||
      generatingCode ||
      (shownCode.code && !codeExpired) ||
      autoCodeAttempted.current
    ) {
      return;
    }
    // One automatic attempt per open sheet, including StrictMode's effect replay.
    autoCodeAttempted.current = true;
    void generateCode();
  }, [tab, busy, generatingCode, shownCode.code, codeExpired, generateCode]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl! sm:max-h-[calc(100dvh-4rem)] sm:w-full">
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
          onValueChange={(value) => {
            if (value === "link" || value === "code") {
              setTab(value);
            }
          }}
          value={tab}
        >
          <TabsList
            appearance="raised"
            className="grid h-auto min-h-11 w-full grid-cols-2 rounded-2xl! p-1"
          >
            <TabsTrigger
              appearance="raised"
              className="min-h-11 rounded-xl"
              value="link"
            >
              Link
            </TabsTrigger>
            <TabsTrigger
              appearance="raised"
              className="min-h-11 rounded-xl"
              value="code"
            >
              Code
            </TabsTrigger>
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
                          "chip-3d min-h-11 cursor-pointer rounded-lg! px-3 text-xs",
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
                    <Input
                      aria-label="Invite link"
                      className="min-h-11 w-full rounded-xl! pr-12! text-base sm:text-sm"
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
                      className="icon-btn-3d absolute top-1/2 right-1 flex size-11 -translate-y-1/2 items-center justify-center rounded-full"
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
              <div className="surface-3d flex flex-col items-center justify-center gap-3 rounded-2xl! p-4 text-center">
                <p className="text-muted-foreground text-xs">
                  No link yet — generate one to share with others.
                </p>
                <Button
                  className="min-h-11 rounded-2xl! px-4 text-sm"
                  variant="premium"
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
                </Button>
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
                      "chip-3d min-h-11 cursor-pointer rounded-lg! px-3 text-xs",
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
                  <Input
                    aria-label="Invite code"
                    className="min-h-11 w-full rounded-xl! pr-12! text-center font-mono text-base font-semibold tracking-[0.3em]"
                    id="den-invite-code"
                    onFocus={(event) => {
                      event.currentTarget.select();
                    }}
                    readOnly
                    value={shownCode.code}
                  />
                  <button
                    aria-label={copiedCode ? "Copied" : "Copy invite code"}
                    className="icon-btn-3d absolute top-1/2 right-1 flex size-11 -translate-y-1/2 items-center justify-center rounded-full"
                    disabled={busy || generatingCode || codeExpired}
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
                <p className="text-muted-foreground text-[11px]">
                  Copy it rather than reading it aloud — 0/O and 1/I are easy to
                  mistype.
                </p>
              </div>
            ) : (
              <div className="surface-3d flex flex-col items-center justify-center gap-3 rounded-2xl! p-4 text-center">
                {codeError ? null : (
                  <Loader2
                    aria-hidden
                    className="text-muted-foreground size-5 animate-spin motion-reduce:animate-none"
                  />
                )}
                <output className="text-muted-foreground text-xs">
                  {codeError
                    ? "Your invite code isn't ready yet."
                    : "Creating your invite code…"}
                </output>
              </div>
            )}
            {codeError ? (
              <p className="text-destructive text-xs" role="alert">
                {codeError}
              </p>
            ) : null}
          </TabsContent>
        </Tabs>

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
            Close
          </Button>
          {tab === "link" && (
            <Button
              className="min-h-11 rounded-2xl! px-4 text-sm"
              variant="premium"
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
            </Button>
          )}
          {tab === "code" && (shownCode.code || codeError) && (
            <Button
              className="min-h-11 rounded-2xl! px-4 text-sm"
              variant="premium"
              disabled={busy || generatingCode}
              onClick={() => {
                void generateCode();
              }}
              type="button"
            >
              <RefreshCw
                aria-hidden
                className={generatingCode ? "size-4 animate-spin" : "size-4"}
              />
              {codeError
                ? "Try again"
                : codeButtonLabel(generatingCode, shownCode.code)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
