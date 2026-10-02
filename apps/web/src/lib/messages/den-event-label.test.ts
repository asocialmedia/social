import { describe, expect, test } from "bun:test";

import type { DenMembershipEvent } from "@/lib/messages/types";

import { denEventIsAboutMe, denEventLine } from "./den-event-label";

const ME = "u-me";
const OTHER = "u-other";

function event(
  overrides: Partial<DenMembershipEvent> & {
    action: DenMembershipEvent["action"];
  }
): DenMembershipEvent {
  return {
    actorId: OTHER,
    actorName: "Ada",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    id: "e-1",
    targetName: "Bob",
    targetUserId: "u-bob",
    ...overrides,
  };
}

describe("denEventLine", () => {
  test("names the creator on the den's first line", () => {
    expect(
      denEventLine(
        event({
          action: "CREATED",
          actorId: "u-me",
          actorName: "Me",
          targetName: null,
          targetUserId: null,
        }),
        ME
      )
    ).toBe("You created the den");
  });

  test("an add names both ends, a link join names one", () => {
    // The two joins are different: one is somebody being put in a room by
    // somebody else, the other is the room gaining a member through a door.
    expect(
      denEventLine(
        event({
          action: "JOINED",
          actorId: OTHER,
          actorName: "Ada",
          targetName: "Bob",
          targetUserId: "u-bob",
        }),
        ME
      )
    ).toBe("Ada added Bob");
    expect(
      denEventLine(
        event({
          action: "JOINED",
          actorId: "u-bob",
          actorName: "Bob",
          targetName: "Bob",
          targetUserId: "u-bob",
        }),
        ME
      )
    ).toBe("Bob joined the den");
  });

  test("the reader is 'You' on either end of the line", () => {
    expect(
      denEventLine(
        event({
          action: "LEFT",
          actorId: ME,
          actorName: "Me",
          targetName: "Me",
          targetUserId: ME,
        }),
        ME
      )
    ).toBe("You left the den");
    expect(
      denEventLine(
        event({
          action: "PROMOTED",
          actorId: OTHER,
          actorName: "Ada",
          targetName: "Me",
          targetUserId: ME,
        }),
        ME
      )
    ).toBe("Ada made you an Elder");
  });

  test("promotion and demotion say Elder, never the stored ADMIN", () => {
    expect(
      denEventLine(
        event({
          action: "PROMOTED",
          actorName: "Ada",
          targetName: "Bob",
        }),
        ME
      )
    ).toBe("Ada made Bob an Elder");
    expect(
      denEventLine(
        event({
          action: "DEMOTED",
          actorName: "Ada",
          targetName: "Bob",
        }),
        ME
      )
    ).toBe("Ada removed Bob as Elder");
    for (const action of ["PROMOTED", "DEMOTED"] as const) {
      expect(denEventLine(event({ action, actorName: "Ada" }), ME)).not.toMatch(
        /admin/iu
      );
    }
  });

  test("names that are missing read as Someone rather than as a blank", () => {
    expect(
      denEventLine(
        event({
          action: "REMOVED",
          actorId: null,
          actorName: null,
        }),
        ME
      )
    ).toBe("Someone removed Bob");
  });

  test("every action has a line", () => {
    const actions = [
      "CREATED",
      "JOINED",
      "LEFT",
      "REMOVED",
      "PROMOTED",
      "DEMOTED",
      "OWNER_TRANSFERRED",
    ] as const;
    for (const action of actions) {
      const line = denEventLine(event({ action }), ME);
      expect(line.length).toBeGreaterThan(0);
      expect(line).toMatch(/den|Elder|removed|added|joined|handed/u);
    }
  });
});

describe("denEventIsAboutMe", () => {
  test("true when the reader is actor or target", () => {
    expect(
      denEventIsAboutMe(
        event({ action: "PROMOTED", targetName: "Me", targetUserId: ME }),
        ME
      )
    ).toBe(true);
    expect(
      denEventIsAboutMe(
        event({ action: "LEFT", actorId: ME, actorName: "Me" }),
        ME
      )
    ).toBe(true);
    expect(denEventIsAboutMe(event({ action: "REMOVED" }), ME)).toBe(false);
  });
});
