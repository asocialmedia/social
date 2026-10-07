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
  InputOTP: ({
    children,
    value,
    inputMode,
    "aria-invalid": invalid,
    "aria-describedby": describedBy,
  }: {
    children: ReactNode;
    value: string;
    inputMode: string;
    "aria-invalid": boolean;
    "aria-describedby": string;
  }) => (
    <div
      aria-describedby={describedBy}
      aria-invalid={invalid}
      data-input-mode={inputMode}
      data-otp-value={value}
    >
      {children}
    </div>
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
  test("explains automatic checking and offers a dismissal", () => {
    const html = renderJoinDialog();
    expect(html).toContain("Join a den");
    expect(html).toContain("Enter an invite code to find your den.");
    expect(html).toContain("all 6 characters");
    expect(html).toContain("Cancel");
    expect(html).not.toContain("Continue");
  });

  test("renders 6 OTP slots for the 6-character short code", () => {
    const html = renderJoinDialog();
    for (let i = 0; i < 6; i += 1) {
      expect(html).toContain(`data-slot-index="${i}"`);
    }
  });

  test("there is no manual submit button for initial code entry", () => {
    const html = renderJoinDialog();
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain("Try again");
  });

  test("uses an alphanumeric keyboard and associates feedback with the input", () => {
    const html = renderJoinDialog();
    expect(html).toContain('data-input-mode="text"');
    expect(html).toContain('aria-invalid="false"');
    const describedBy = html.match(/aria-describedby="(?<id>[^"]+)"/u)?.groups
      ?.id;
    expect(describedBy).toBeDefined();
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toContain("<output");
  });

  test("does not render when open is false", () => {
    const html = renderJoinDialog({ open: false });
    expect(html).not.toContain("Join a den");
  });
});
