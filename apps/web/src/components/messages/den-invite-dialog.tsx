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

// The den's invite sheet: the link and short code doors, how long each lives, and
// the actions that change either independently.
//
// Tabs split "Link" and "Code" so each door can be shared or rotated on its own
// preset without interfering with the other. Link remains the default tab to preserve
// the established flow.
export function DenInviteDialog({
  busy,
  inviteCode,
  inviteDurationDays,
  inviteExpiresAt,
  inviteShortCode = null,
  inviteShortCodeDurationDays = null,
  inviteShortCodeExpiresAt = null,
  now,
  onGenerate,
  onGenerateCode,
  onOpenChange,
  open,
}: {
  busy: boolean;
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
  onGenerateCode?: (
    durationDays: DenInviteDurationDays | null
  ) => Promise<DenInviteShortCodeMinted | null>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [tab, setTab] = useState<"link" | "code">("link");

  const seededLink =
    inviteDurationDays === 1 ||
    inviteDurationDays === 7 ||
    inviteDurationDays === 30
      ? inviteDurationDays
      : DEFAULT_DURATION_DAYS;
  const [selectedLinkDuration, setSelectedLinkDuration] =
    useState<DenInviteDurationDays | null>(seededLink);
  const [shownLink, setShownLink] = useState<{
    inviteCode: string | null;
    inviteExpiresAt: Date | null;
  }>({
    inviteCode,
    inviteExpiresAt,
  });
  const [copiedLink, setCopiedLink] = useState(false);

  const seededCode =
    inviteShortCodeDurationDays === 1 ||
    inviteShortCodeDurationDays === 7 ||
    inviteShortCodeDurationDays === 30
      ? inviteShortCodeDurationDays
      : DEFAULT_DURATION_DAYS;
  const [selectedCodeDuration, setSelectedCodeDuration] =
    useState<DenInviteDurationDays | null>(seededCode);
  const [shownCode, setShownCode] = useState<{
    inviteShortCode: string | null;
    inviteShortCodeExpiresAt: Date | null;
  }>({
    inviteShortCode: inviteShortCode ?? null,
    inviteShortCodeExpiresAt: inviteShortCodeExpiresAt ?? null,
  });
  const [copiedCode, setCopiedCode] = useState(false);

  const linkExpired =
    shownLink.inviteExpiresAt !== null && shownLink.inviteExpiresAt <= now;
  const linkCountdown = denInviteCountdown(shownLink.inviteExpiresAt, now);

  const codeExpired =
    shownCode.inviteShortCodeExpiresAt !== null &&
    shownCode.inviteShortCodeExpiresAt <= now;
  const codeCountdown = denInviteCountdown(
    shownCode.inviteShortCodeExpiresAt,
    now
  );

  const copyLink = async () => {
    if (!shownLink.inviteCode) {
      return;
    }
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const link = denInviteUrl(origin, shownLink.inviteCode);
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
    if (!shownCode.inviteShortCode) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shownCode.inviteShortCode);
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
      setShownLink(minted);
      setCopiedLink(false);
    }
  };

  const generateCode = async () => {
    if (!onGenerateCode) {
      return;
    }
    const minted = await onGenerateCode(selectedCodeDuration);
    if (minted) {
      setShownCode(minted);
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
                      setSelectedLinkDuration(days);
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
                  value={
                    shownLink.inviteCode
                      ? denInviteUrl(
                          typeof window === "undefined"
                            ? ""
                            : window.location.origin,
                          shownLink.inviteCode
                        )
                      : ""
                  }
                />
                <button
                  aria-label={copiedLink ? "Copied" : "Copy invite link"}
                  className="icon-btn-3d absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center"
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
                      setSelectedCodeDuration(days);
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

            {shownCode.inviteShortCode ? (
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
                    value={shownCode.inviteShortCode}
                  />
                  <button
                    aria-label={copiedCode ? "Copied" : "Copy invite code"}
                    className="icon-btn-3d absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center"
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
                  disabled={busy}
                  onClick={() => {
                    void generateCode();
                  }}
                  type="button"
                >
                  <RefreshCw aria-hidden className="size-3.5" />
                  {busy ? "Creating…" : "Generate code"}
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
              disabled={busy}
              onClick={() => {
                void generateLink();
              }}
              type="button"
            >
              <RefreshCw aria-hidden className="size-4" />
              {busy ? "Creating…" : "Generate new link"}
            </button>
          )}
          {tab === "code" && shownCode.inviteShortCode && (
            <button
              className="btn-3d inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                void generateCode();
              }}
              type="button"
            >
              <RefreshCw aria-hidden className="size-4" />
              {busy ? "Creating…" : "Generate new code"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
