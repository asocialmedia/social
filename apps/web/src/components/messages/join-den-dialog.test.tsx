import { describe, expect, mock, test } from "bun:test";

import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";

import { JoinDenDialog } from "./join-den-dialog";

// Mock router
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: mock(() => {}),
  }),
}));

// Mock dialog primitives to render inline for renderToString
mock.module("@asm/ui/shadui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

// Mock input-otp primitives to render input and slots inline
mock.module("@asm/ui/shadui/input-otp", () => ({
  InputOTP: ({ children, value }: { children: ReactNode; value: string }) => (
    <div data-otp-value={value}>{children}</div>
  ),
  InputOTPGroup: ({ children }: { children: ReactNode }) => (
    <div className="otp-group">{children}</div>
  ),
  InputOTPSlot: ({ index }: { index: number }) => (
    <div data-slot-index={index}>slot</div>
  ),
}));

function renderJoinDialog(
  props: Partial<Parameters<typeof JoinDenDialog>[0]> = {}
): string {
  return renderToString(
    <JoinDenDialog onOpenChange={() => {}} open={true} {...props} />
  );
}

describe("JoinDenDialog", () => {
  test("renders title, description, and cancel/continue buttons", () => {
    const html = renderJoinDialog();
    expect(html).toContain("Join a den");
    expect(html).toContain("Enter the 6-character code");
    expect(html).toContain("Cancel");
    expect(html).toContain("Continue");
  });

  test("renders 6 OTP slots for the 6-character short code", () => {
    const html = renderJoinDialog();
    for (let i = 0; i < 6; i += 1) {
      expect(html).toContain(`data-slot-index="${i}"`);
    }
  });

  test("the continue button is disabled initially when input is empty", () => {
    const html = renderJoinDialog();
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Continue<\/button>/u);
  });

  test("does not render when open is false", () => {
    const html = renderJoinDialog({ open: false });
    expect(html).not.toContain("Join a den");
  });
});
