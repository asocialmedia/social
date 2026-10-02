import { describe, expect, test } from "bun:test";

import type { DenRole } from "@asm/db/messages/dens";

import {
  DEN_ASSIGNABLE_ROLES,
  denAffordances,
  denConfirmCopy,
  denRoleAction,
  denRoleLabel,
} from "./den-permissions";
import type { DenAffordanceTarget } from "./den-permissions";

function viewer(role: DenRole | null) {
  // The flag and the role come from the same detail row and the same request, so
  // a fixture that disagrees would be a state the server cannot produce.
  return { canManage: role === "OWNER" || role === "ADMIN", role };
}

function target(role: DenRole, isSelf = false): DenAffordanceTarget {
  return { isSelf, role };
}

describe("denAffordances, den-wide controls", () => {
  test("an owner can do every den-wide thing", () => {
    const affordances = denAffordances({ viewer: viewer("OWNER") });
    expect(affordances.canAddMembers).toBe(true);
    expect(affordances.canRename).toBe(true);
    expect(affordances.canCopyInvite).toBe(true);
    expect(affordances.canRotateInvite).toBe(true);
    expect(affordances.canDeleteDen).toBe(true);
    expect(affordances.canLeave).toBe(true);
  });

  test("an admin manages the roster but cannot dissolve the den", () => {
    // The asymmetry is the point of the role: an admin adds and removes, and the
    // owner alone destroys. Both facts are in the server's requireDenManager /
    // requireDenOwner split. `canRemove` here is the den-wide answer with no
    // target, so this row only asserts the remove path through `denRoleAction`.
    const affordances = denAffordances({ viewer: viewer("ADMIN") });
    expect(affordances.canAddMembers).toBe(true);
    expect(affordances.canDeleteDen).toBe(false);
    expect(
      denRoleAction({
        affordances: denAffordances({
          target: target("MEMBER"),
          viewer: viewer("ADMIN"),
        }),
        target: target("MEMBER"),
      })
    ).toEqual({ kind: "remove" });
  });

  test("a plain member can only leave", () => {
    const affordances = denAffordances({ viewer: viewer("MEMBER") });
    expect(affordances.canAddMembers).toBe(false);
    expect(affordances.canCopyInvite).toBe(false);
    expect(affordances.canRotateInvite).toBe(false);
    expect(affordances.canRename).toBe(false);
    expect(affordances.canDeleteDen).toBe(false);
    expect(affordances.canLeave).toBe(true);
  });

  test("the role and the server's flag must both say manager", () => {
    // The flag arrives with the role and comes from the same row, so requiring
    // both means a panel opened against a half-stale response draws nothing rather
    // than drawing something the route will refuse. Never a security control: the
    // route re-checks either way.
    expect(
      denAffordances({ viewer: { canManage: false, role: "ADMIN" } })
        .canAddMembers
    ).toBe(false);
    expect(
      denAffordances({ viewer: { canManage: true, role: "MEMBER" } })
        .canAddMembers
    ).toBe(false);
  });

  test("somebody who is not on the roster is offered nothing", () => {
    const affordances = denAffordances({ viewer: viewer(null) });
    expect(affordances).toEqual({
      canAddMembers: false,
      canCopyInvite: false,
      canDeleteDen: false,
      canDemote: false,
      canLeave: false,
      canPromote: false,
      canRemove: false,
      canRename: false,
      canRotateInvite: false,
      canSetRole: false,
    });
  });
});

describe("denAffordances, per roster row", () => {
  test("an owner may remove an admin but not another owner", () => {
    expect(
      denAffordances({
        target: target("ADMIN"),
        viewer: viewer("OWNER"),
      }).canRemove
    ).toBe(true);
    // There is exactly one owner and they cannot be removed; ownership moves by
    // leaving, not by being kicked.
    expect(
      denAffordances({
        target: target("OWNER"),
        viewer: viewer("OWNER"),
      }).canRemove
    ).toBe(false);
  });

  test("an admin cannot remove the owner", () => {
    expect(
      denAffordances({
        target: target("OWNER"),
        viewer: viewer("ADMIN"),
      }).canRemove
    ).toBe(false);
  });

  test("a plain member cannot remove anybody", () => {
    expect(
      denAffordances({
        target: target("MEMBER"),
        viewer: viewer("MEMBER"),
      }).canRemove
    ).toBe(false);
  });

  test("no row offers a self action", () => {
    // Every route that takes a target refuses it with SELF_ACTION and points at
    // `leave`, so a row about the reader carries no controls at all.
    for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
      const self = denAffordances({
        target: target(role, true),
        viewer: viewer("OWNER"),
      });
      expect(self.canRemove).toBe(false);
      expect(self.canSetRole).toBe(false);
    }
  });

  test("only the owner may change a role", () => {
    // Promotion changes who may add and remove, so letting an admin promote would
    // be letting them hand out their own permissions. The role route is owner-only.
    expect(
      denAffordances({
        target: target("MEMBER"),
        viewer: viewer("ADMIN"),
      }).canSetRole
    ).toBe(false);
    expect(
      denAffordances({
        target: target("MEMBER"),
        viewer: viewer("OWNER"),
      }).canSetRole
    ).toBe(true);
  });

  test("the owner's own row cannot be reassigned", () => {
    // OWNER is not an assignable role at all, so the owner's row offers nothing.
    const affordances = denAffordances({
      target: target("OWNER"),
      viewer: viewer("OWNER"),
    });
    expect(affordances.canSetRole).toBe(false);
    expect(affordances.canPromote).toBe(false);
    expect(affordances.canDemote).toBe(false);
  });

  test("promote and demote are each offered for exactly one role", () => {
    const owner = viewer("OWNER");
    expect(
      denAffordances({ target: target("MEMBER"), viewer: owner }).canPromote
    ).toBe(true);
    expect(
      denAffordances({ target: target("ADMIN"), viewer: owner }).canDemote
    ).toBe(true);
    // Not both for the same row, or the menu would offer two contradictory moves.
    expect(
      denAffordances({ target: target("MEMBER"), viewer: owner }).canDemote
    ).toBe(false);
    expect(
      denAffordances({ target: target("ADMIN"), viewer: owner }).canPromote
    ).toBe(false);
  });
});

describe("denRoleAction", () => {
  test("the owner's rows on someone else's den prefer the role move over a kick", () => {
    // One action per row, and promotion is the constructive one when it is
    // available, so the menu never presents remove when make-admin would do.
    expect(
      denRoleAction({
        affordances: denAffordances({
          target: target("MEMBER"),
          viewer: viewer("OWNER"),
        }),
        target: target("MEMBER"),
      })
    ).toEqual({ kind: "promote" });
    expect(
      denRoleAction({
        affordances: denAffordances({
          target: target("ADMIN"),
          viewer: viewer("OWNER"),
        }),
        target: target("ADMIN"),
      })
    ).toEqual({ kind: "demote" });
  });

  test("an admin who cannot reassign roles falls back to removal", () => {
    expect(
      denRoleAction({
        affordances: denAffordances({
          target: target("MEMBER"),
          viewer: viewer("ADMIN"),
        }),
        target: target("MEMBER"),
      })
    ).toEqual({ kind: "remove" });
  });

  test("a row with no legal action has no menu at all", () => {
    expect(
      denRoleAction({
        affordances: denAffordances({
          target: target("MEMBER"),
          viewer: viewer("MEMBER"),
        }),
        target: target("MEMBER"),
      })
    ).toBeNull();
    expect(
      denRoleAction({
        affordances: denAffordances({
          target: target("OWNER"),
          viewer: viewer("OWNER"),
        }),
        target: target("OWNER"),
      })
    ).toBeNull();
  });
});

describe("denRoleLabel", () => {
  test("title-cases the database role", () => {
    // The chip is the one place a role is shown to a person, so it is not
    // SCREAMING_SNAKE the way the column is.
    expect(denRoleLabel("OWNER")).toBe("Owner");
    expect(denRoleLabel("ADMIN")).toBe("Admin");
    expect(denRoleLabel("MEMBER")).toBe("Member");
  });
});

describe("DEN_ASSIGNABLE_ROLES", () => {
  test("ownership is not in the assignable set", () => {
    // Ownership moves by leaving or by dissolving, never by promotion, so the type
    // itself excludes it rather than each call site remembering to check.
    expect([...DEN_ASSIGNABLE_ROLES]).toEqual(["ADMIN", "MEMBER"]);
  });
});

describe("denConfirmCopy", () => {
  test("removing a member says what they keep and what they lose", () => {
    const copy = denConfirmCopy({ kind: "remove-member", memberName: "Ada" });
    expect(copy.title).toBe("Remove Ada?");
    expect(copy.confirmLabel).toBe("Remove Ada");
    // The key fact is asymmetry: they keep everything they already read.
    expect(copy.description).toContain("stays on their device");
    expect(copy.description).toContain("immediately");
  });

  test("a nameless member still gets a readable dialog", () => {
    expect(denConfirmCopy({ kind: "remove-member" }).title).toBe(
      "Remove This person?"
    );
  });

  test("leaving warns about ownership transfer", () => {
    const copy = denConfirmCopy({ kind: "leave-den" });
    expect(copy.title).toBe("Leave this den?");
    expect(copy.description).toContain("longest-standing");
  });

  test("deleting the den is the only copy that promises nothing is kept", () => {
    const copy = denConfirmCopy({ kind: "delete-den" });
    expect(copy.title).toBe("Delete this den?");
    expect(copy.description).toContain("cannot be undone");
    // The removal copy must not be reused here: it promises the reader keeps
    // their history, which is the opposite of what dissolving means.
    expect(copy.description).not.toContain("stays on their device");
  });

  test("the three confirm labels are distinct, so no dialog is mislabelled", () => {
    const labels = new Set([
      denConfirmCopy({ kind: "delete-den" }).confirmLabel,
      denConfirmCopy({ kind: "leave-den" }).confirmLabel,
      denConfirmCopy({ kind: "remove-member", memberName: "Ada" }).confirmLabel,
    ]);
    expect(labels.size).toBe(3);
  });
});
