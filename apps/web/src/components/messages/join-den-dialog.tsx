"use client";

import { isDenShortCode } from "@asm/db/messages/dens";
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
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface JoinDenDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

// Dialog that collects a 6-character den invite code via OTP boxes.
// Typing or pasting automatically uppercases and strips non-alphanumeric chars.
// Submitting pushes the router to `/messages/join/[code]` which uses the
// existing invite preview and join screen.
export function JoinDenDialog({ onOpenChange, open }: JoinDenDialogProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canSubmit = code.length === 6 && isDenShortCode(code);

  const handleChange = (value: string) => {
    const sanitized = value.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
    setCode(sanitized);
    if (error) {
      setError(null);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (code.length < 6) {
      setError("That code needs all 6 characters.");
      return;
    }
    if (!isDenShortCode(code)) {
      setError("That code is not valid.");
      return;
    }
    router.push(`/messages/join/${code}`);
    onOpenChange(false);
    setCode("");
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setCode("");
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join a den</DialogTitle>
          <DialogDescription>Enter the 6-character code</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col items-center justify-center gap-2 py-2">
            <InputOTP
              aria-label="Den invite code"
              autoFocus
              maxLength={6}
              onChange={handleChange}
              value={code}
            >
              <InputOTPGroup className="gap-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <InputOTPSlot
                    className="h-12 w-10 text-lg uppercase sm:h-14 sm:w-12 sm:text-2xl"
                    index={index}
                    key={index}
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>

            {error ? (
              <p className="text-destructive text-xs" role="alert">
                {error}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Enter the 6-character code
              </p>
            )}
          </div>

          <DialogFooter>
            <button
              className="text-muted-foreground px-3 py-1.5 text-sm font-medium"
              onClick={() => handleOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="btn-3d inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium disabled:opacity-50"
              disabled={!canSubmit}
              type="submit"
            >
              Continue
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
