"use client";

import { DEN_SHORT_CODE_LENGTH } from "@asm/db/messages/dens";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@asm/ui/shadui/input-otp";
import { ArrowLeft, KeyRound, Loader2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { fetchDenInvitePreview, joinDen } from "@/lib/messages/client";
import {
  createDenCodeEntryController,
  denCodeEntryFailure,
  normalizeDenEntryCode,
} from "@/lib/messages/den-code-entry";
import type {
  DenCodeEntryError,
  DenCodeEntryState,
} from "@/lib/messages/den-code-entry";
import {
  denJoinActionLabel,
  denJoinDescription,
  denJoinTitle,
} from "@/lib/messages/den-invite";
import { denMemberCountLabel } from "@/lib/messages/den-label";
import { cn } from "@/lib/utils";

import "./join-den-dialog.css";

export interface JoinDenDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function JoinDenDialog(props: JoinDenDialogProps) {
  return props.open ? <JoinDenDialogSession {...props} /> : null;
}

function JoinDenDialogSession({ onOpenChange, open }: JoinDenDialogProps) {
  const router = useRouter();
  const feedbackId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [entry, setEntry] = useState<DenCodeEntryState>({
    code: "",
    status: "editing",
  });
  const controllerRef = useRef<ReturnType<
    typeof createDenCodeEntryController
  > | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<DenCodeEntryError | null>(null);
  const joinPending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const controller = createDenCodeEntryController({
      lookup: fetchDenInvitePreview,
      onStateChange: setEntry,
    });
    controllerRef.current = controller;
    return () => {
      mounted.current = false;
      controller.deactivate();
      controllerRef.current = null;
    };
  }, []);

  const accepted = entry.status === "accepted";
  useEffect(() => {
    if (accepted) {
      headingRef.current?.focus();
    }
  }, [accepted]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      mounted.current = false;
      controllerRef.current?.deactivate();
    }
    onOpenChange(nextOpen);
  };

  const handleJoin = async () => {
    if (entry.status !== "accepted" || joinPending.current) {
      return;
    }
    joinPending.current = true;
    setJoining(true);
    setJoinError(null);
    try {
      let conversationId = entry.outcome.den.id;
      if (entry.outcome.kind === "joinable") {
        const { conversationId: joinedConversationId } = await joinDen(
          entry.code
        );
        conversationId = joinedConversationId;
      }
      if (!mounted.current) {
        return;
      }
      router.push(`/messages?c=${encodeURIComponent(conversationId)}`);
      handleOpenChange(false);
    } catch (error) {
      if (!mounted.current) {
        return;
      }
      const failure = denCodeEntryFailure(error);
      if (failure.invalid) {
        controllerRef.current?.reject(error);
      } else {
        setJoinError({
          ...failure,
          message: failure.retryable
            ? "Couldn't join this den just now. Wait a moment and try again."
            : failure.message,
        });
      }
      joinPending.current = false;
      setJoining(false);
    }
  };

  const entryError = entry.status === "error" ? entry.error : null;
  const invalid = Boolean(entryError?.invalid);

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-2xl! sm:max-w-md">
        {entry.status === "accepted" ? (
          <>
            <DialogHeader>
              <DialogTitle
                className="outline-none"
                ref={headingRef}
                tabIndex={-1}
              >
                {denJoinTitle(entry.outcome)}
              </DialogTitle>
              <DialogDescription>
                {denJoinDescription(entry.outcome)}
              </DialogDescription>
            </DialogHeader>
            <div className="surface-3d flex items-center gap-4 rounded-2xl! p-4">
              <span className="chip-3d flex size-12 shrink-0 items-center justify-center rounded-2xl!">
                <Users aria-hidden className="text-primary size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">
                  {entry.outcome.den.name || "Unnamed den"}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {denMemberCountLabel(entry.outcome.den.memberCount)}
                </p>
              </div>
            </div>
            {joinError ? (
              <p className="text-destructive text-xs" role="alert">
                {joinError.message}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                className="min-h-11 rounded-2xl! px-4 text-sm"
                disabled={joining}
                onClick={() => {
                  setJoinError(null);
                  void controllerRef.current?.change("");
                }}
                type="button"
                variant="outline"
              >
                <ArrowLeft aria-hidden className="size-3.5" />
                Use another code
              </Button>
              {joinError?.needsMessages ? (
                <Button
                  asChild
                  className="min-h-11 rounded-2xl! px-4 text-sm"
                  variant="premium"
                >
                  <Link href="/messages">Set up Messages</Link>
                </Button>
              ) : (
                <Button
                  className="min-h-11 rounded-2xl! px-4 text-sm"
                  disabled={
                    joining || (joinError !== null && !joinError.retryable)
                  }
                  onClick={() => {
                    void handleJoin();
                  }}
                  type="button"
                  variant="premium"
                >
                  {joining ? (
                    <Loader2
                      aria-hidden
                      className="size-4 animate-spin motion-reduce:animate-none"
                    />
                  ) : null}
                  {denJoinActionLabel(entry.outcome, joining)}
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Join a den</DialogTitle>
              <DialogDescription>
                Enter an invite code to find your den.
              </DialogDescription>
            </DialogHeader>
            <form
              className="flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                void controllerRef.current?.check();
              }}
            >
              <div className="flex flex-col items-center gap-4 py-3">
                <span className="chip-3d flex size-11 items-center justify-center rounded-2xl!">
                  <KeyRound
                    aria-hidden
                    className="text-muted-foreground size-4"
                  />
                </span>
                <InputOTP
                  aria-describedby={feedbackId}
                  aria-invalid={invalid}
                  aria-label="Den invite code"
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoFocus
                  inputMode="text"
                  maxLength={DEN_SHORT_CODE_LENGTH}
                  onChange={(value) => {
                    void controllerRef.current?.change(value);
                  }}
                  pasteTransformer={normalizeDenEntryCode}
                  value={entry.code}
                >
                  <InputOTPGroup
                    className={cn(
                      "gap-2",
                      invalid &&
                        "animate-[den-code-shake_240ms_ease-in-out] motion-reduce:animate-none"
                    )}
                  >
                    {Array.from(
                      { length: DEN_SHORT_CODE_LENGTH },
                      (_, index) => (
                        <InputOTPSlot
                          className={cn(
                            "h-11 w-8 rounded-xl! font-mono text-lg uppercase min-[375px]:w-9 sm:h-14 sm:w-12 sm:text-2xl",
                            invalid &&
                              "border-destructive/70 text-destructive ring-destructive/15 border shadow-[inset_0_2px_4px_rgba(0,0,0,0.25)] ring-2"
                          )}
                          index={index}
                          key={index}
                        />
                      )
                    )}
                  </InputOTPGroup>
                </InputOTP>
                <div
                  className="flex min-h-9 items-center justify-center text-center"
                  id={feedbackId}
                >
                  {entryError ? (
                    <p
                      className="text-destructive max-w-72 text-xs leading-relaxed"
                      role="alert"
                    >
                      {entryError.message}
                    </p>
                  ) : (
                    <output className="text-muted-foreground flex items-center gap-2 text-xs">
                      {entry.status === "checking" ? (
                        <Loader2
                          aria-hidden
                          className="size-3.5 animate-spin motion-reduce:animate-none"
                        />
                      ) : null}
                      {entry.status === "checking"
                        ? "Checking your code…"
                        : "We'll check it as soon as you enter all 6 characters."}
                    </output>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button
                  className="min-h-11 rounded-2xl! px-4 text-sm"
                  onClick={() => handleOpenChange(false)}
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
                {entryError?.retryable ? (
                  <Button
                    className="min-h-11 rounded-2xl! px-4 text-sm"
                    type="submit"
                    variant="premium"
                  >
                    Try again
                  </Button>
                ) : null}
                {entryError?.needsMessages ? (
                  <Button
                    asChild
                    className="min-h-11 rounded-2xl! px-4 text-sm"
                    variant="premium"
                  >
                    <Link href="/messages">Set up Messages</Link>
                  </Button>
                ) : null}
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
