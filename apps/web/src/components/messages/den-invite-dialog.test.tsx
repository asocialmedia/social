import { describe, expect, mock, test } from "bun:test";

import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";

import {
  DenInviteDialog,
  reseededInviteDoor,
  reseededInviteDuration,
} from "./den-invite-dialog";

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

  test("renders the link tab empty state when inviteCode is null", () => {
    const html = renderDialog({
      inviteCode: null,
      inviteDurationDays: null,
      inviteExpiresAt: null,
    });
    expect(html).toContain("No link yet — generate one to share with others.");
    expect(html).toContain("Generate link");
    expect(html).not.toContain('id="den-invite-link"');
  });

  // The per-door busy flags. A mint on one door must not disable the other
  // door's writer - each door has its own rotation budget and the two are
  // independent - while the sheet-gate disables both. The code tab's writer is
  // not drawn for the default (link) tab, so the assertion rides on the code
  // tab's copy button, which the tab mock renders for both tabs.
  test("a code mint disables the code tab's controls but leaves the link's free", () => {
    const busyHtml = renderDialog({ codeBusy: true });
    expect(busyHtml).toContain('aria-label="Copy invite code"');
    expect(busyHtml).toContain(
      '<button aria-label="Copy invite code" class="icon-btn-3d absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center" disabled=""'
    );
    expect(busyHtml).not.toContain(
      '<button aria-label="Copy invite link" class="icon-btn-3d absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center" disabled=""'
    );
  });

  // The re-seed decisions, pinned where they are pure. While the sheet is
  // closed it follows the props; while it is open the manager's session state
  // stands and a racing refetch must not replace what they are looking at.
  describe("reseededInviteDoor", () => {
    test("a closed sheet follows the live props", () => {
      const seed = reseededInviteDoor(false, {
        code: "ABC123",
        expiresAt: FUTURE,
      });
      expect(seed).toEqual({ code: "ABC123", expiresAt: FUTURE });
    });

    test("an open sheet answers null so the session state stands", () => {
      expect(
        reseededInviteDoor(true, { code: "ABC123", expiresAt: FUTURE })
      ).toBeNull();
    });
  });

  describe("reseededInviteDuration", () => {
    test("a closed sheet re-seeds to the den's last preset", () => {
      expect(reseededInviteDuration(false, 30)).toBe(30);
      expect(reseededInviteDuration(false, 1)).toBe(1);
    });

    test("an out-of-band preset falls back to the default, never to null", () => {
      // Null means "the den last minted a code that never expires", which is
      // not a duration a picker can show, so it seeds the default.
      expect(reseededInviteDuration(false, null)).toBe(7);
      expect(reseededInviteDuration(false, 5)).toBe(7);
    });

    test("an open sheet answers null: the manager is choosing", () => {
      expect(reseededInviteDuration(true, 30)).toBeNull();
    });
  });
});
