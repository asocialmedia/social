import { describe, expect, mock, test } from "bun:test";

import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";

import { DenInviteDialog } from "./den-invite-dialog";

// Radix Dialog renders into a portal which SSR renderToString drops.
// Mocking the primitives to render their children inline lets renderToString
// assert the actual markup and text the dialog produces.
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

// Also ensure Radix TabsContent renders for both tabs during testing
mock.module("@asm/ui/shadui/tabs", () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({
    children,
    value,
  }: {
    children: ReactNode;
    value: string;
  }) => <div data-tab-content={value}>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => (
    <div role="tablist">{children}</div>
  ),
  TabsTrigger: ({
    children,
    value,
  }: {
    children: ReactNode;
    value: string;
  }) => (
    <button role="tab" type="button" value={value}>
      {children}
    </button>
  ),
}));

const NOW = new Date("2026-10-07T12:00:00.000Z");
const FUTURE = new Date("2026-10-14T12:00:00.000Z");
const PAST = new Date("2026-10-01T12:00:00.000Z");

function renderDialog(
  props: Partial<Parameters<typeof DenInviteDialog>[0]> = {}
): string {
  return renderToString(
    <DenInviteDialog
      busy={false}
      inviteCode="abc123xyz789"
      inviteDurationDays={7}
      inviteExpiresAt={FUTURE}
      inviteShortCode="ABC123"
      inviteShortCodeDurationDays={7}
      inviteShortCodeExpiresAt={FUTURE}
      now={NOW}
      onGenerate={() => Promise.resolve(null)}
      onGenerateCode={() => Promise.resolve(null)}
      onOpenChange={() => {}}
      open={true}
      {...props}
    />
  );
}

describe("DenInviteDialog", () => {
  test("renders tabs for Link and Code", () => {
    const html = renderDialog();
    expect(html).toContain('role="tab"');
    expect(html).toContain("Link");
    expect(html).toContain("Code");
  });

  test("renders the link tab with the invite link and expiry choices", () => {
    const html = renderDialog();
    expect(html).toContain("Invite link");
    expect(html).toContain("Link expires");
    expect(html).toContain("abc123xyz789");
    expect(html).toContain("Generate new link");
  });

  test("renders the code tab with the 6-character code and monospaced tracking", () => {
    const html = renderDialog();
    expect(html).toContain("Invite code");
    expect(html).toContain("Code expires");
    expect(html).toContain("ABC123");
    expect(html).toContain("tracking-[0.3em]");
  });

  test("renders empty state in code tab when inviteShortCode is null", () => {
    const html = renderDialog({
      inviteShortCode: null,
      inviteShortCodeDurationDays: null,
      inviteShortCodeExpiresAt: null,
    });
    expect(html).toContain("No code yet — generate one to share with others.");
    expect(html).toContain("Generate code");
    expect(html).not.toContain('id="den-invite-code"');
  });

  test("renders expired message for expired link and code", () => {
    const html = renderDialog({
      inviteExpiresAt: PAST,
      inviteShortCodeExpiresAt: PAST,
    });
    expect(html).toContain(
      "This link has expired. Generate a new one to keep sharing access."
    );
    expect(html).toContain(
      "This code has expired. Generate a new one to keep sharing access."
    );
  });

  test("does not render dialog content when open is false", () => {
    const html = renderDialog({ open: false });
    expect(html).not.toContain("Invite another member");
  });
});
