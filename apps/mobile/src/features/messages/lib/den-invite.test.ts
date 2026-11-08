// Ported from apps/web/src/lib/messages/den-invite.test.ts: the join screen's
// decisions, tested as decisions rather than rendered branches.
import { expect, test } from "bun:test";

import {
  denInviteCountdown,
  denInviteIsExpired,
  denInvitePath,
  denInviteUrl,
  denIsFull,
  denJoinActionLabel,
  denJoinDescription,
  denJoinFailure,
  denJoinFailureCopy,
  denJoinOutcome,
  denJoinTitle,
} from "./den-invite";

function preview(overrides = {}) {
  return {
    den: {
      avatarMediaId: null,
      id: "den",
      memberCount: 3,
      name: "Den",
      ownerId: "owner",
    },
    expired: false,
    isBanned: false,
    isMember: false,
    ...overrides,
  };
}

test("an empty code answers the messages index, never a join link", () => {
  expect(denInvitePath("   ")).toBe("/messages");
  expect(denInvitePath("AbC-123 ")).toBe("/messages/join/abc-123");
  expect(denInviteUrl("https://example.com/", "AbC-123 ")).toBe(
    "https://example.com/messages/join/abc-123"
  );
  expect(denInviteUrl("https://example.com", "  ")).toBe(
    "https://example.com/messages"
  );
});

test("the outcome prefers expired, then ban, then membership, then capacity", () => {
  expect(denJoinOutcome({ preview: null })).toEqual({
    kind: "invalid",
    reason: "unknown-code",
  });
  expect(
    denJoinOutcome({ preview: preview({ expired: true, isMember: true }) }).kind
  ).toBe("already-member");
  expect(denJoinOutcome({ preview: preview({ expired: true }) }).kind).toBe(
    "expired"
  );
  expect(
    denJoinOutcome({ preview: preview({ isBanned: true, isMember: true }) })
      .kind
  ).toBe("banned");
  expect(denJoinOutcome({ preview: preview({ isMember: true }) }).kind).toBe(
    "already-member"
  );
  expect(
    denJoinOutcome({
      preview: preview({ den: { ...preview().den, memberCount: 100 } }),
    }).kind
  ).toBe("full");
  expect(denJoinOutcome({ preview: preview() }).kind).toBe("joinable");
  expect(denIsFull(100)).toBe(true);
  expect(denIsFull(99)).toBe(false);
});

test("a refused join maps statuses to the five failure screens", () => {
  expect(denJoinFailure(403, "BANNED")).toBe("banned");
  expect(denJoinFailure(404)).toBe("invalid");
  expect(denJoinFailure(409)).toBe("needs-messages");
  expect(denJoinFailure(429)).toBe("rate-limited");
  expect(denJoinFailure(500)).toBe("unavailable");
  expect(denJoinFailure(null)).toBe("unavailable");
});

test("titles, bodies and actions read as web's", () => {
  expect(denJoinTitle({ kind: "invalid", reason: "unknown-code" })).toBe(
    "We couldn't find that den"
  );
  expect(
    denJoinDescription({ kind: "invalid", reason: "unknown-code" })
  ).toContain("Check it and try again.");
  expect(denJoinDescription({ den: preview().den, kind: "expired" })).toContain(
    "has been replaced."
  );
  expect(
    denJoinActionLabel({ den: preview().den, kind: "joinable" }, false)
  ).toBe("Join den");
  expect(
    denJoinActionLabel({ den: preview().den, kind: "already-member" }, false)
  ).toBe("Open den");
  expect(
    denJoinActionLabel({ den: preview().den, kind: "joinable" }, true)
  ).toBe("Joining…");
  expect(denJoinActionLabel({ den: preview().den, kind: "full" }, false)).toBe(
    null
  );
  const banned = denJoinFailureCopy("banned");
  expect(banned.title).toBe("You can't rejoin this den");
  expect(banned.actionLabel).toBe("Back to messages");
  const needsMessages = denJoinFailureCopy("needs-messages");
  expect(needsMessages.title).toBe("Turn on Messages first");
  expect(needsMessages.actionLabel).toBe("Enable Messages");
  const rateLimited = denJoinFailureCopy("rate-limited");
  expect(rateLimited.actionLabel).toBe(null);
  const unavailable = denJoinFailureCopy("unavailable");
  expect(unavailable.title).toBe("Couldn't check this link");
});

test("the countdown tightens as the deadline approaches", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  expect(denInviteCountdown(null, now)).toBe("No expiry");
  expect(denInviteCountdown(new Date("2026-11-07T12:00:30Z"), now)).toBe(
    "Expires in under a minute"
  );
  expect(denInviteCountdown(new Date("2026-11-07T12:30:00Z"), now)).toBe(
    "Expires in 30m"
  );
  expect(denInviteCountdown(new Date("2026-11-07T20:00:00Z"), now)).toBe(
    "Expires in 8h"
  );
  expect(denInviteCountdown(new Date("2026-11-10T12:00:00Z"), now)).toBe(
    "Expires in 3d"
  );
  expect(denInviteIsExpired(new Date("2026-11-07T11:59:59Z"), now)).toBe(true);
  expect(denInviteIsExpired(new Date("2026-11-07T12:00:01Z"), now)).toBe(false);
});
