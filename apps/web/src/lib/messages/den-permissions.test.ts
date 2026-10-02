import { describe, expect, test } from "bun:test";

import type { DenRole } from "@asm/db/messages/dens";

import {
  DEN_ASSIGNABLE_ROLES,
  denAffordances,
  denConfirmCopy,
  denRoleAction,
  denRoleActionLabel,
  denRoleLabel,
  denViewerRoleLine,
} from "./den-permissions";
import type { DenAffordanceTarget, DenRoleActionKind } from "./den-permissions";

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
      canTransferOwnership: false,
    });
  });
});

describe("denAffordances, per roster row", () => {
  test("an owner may remove an Elder but not another owner", () => {
    expect(
      denAffordances({
        target: target("ADMIN"),
        viewer: viewer("OWNER"),
      }).canRemove
    ).toBe(true);
    // There is exactly one owner and they cannot be removed; ownership moves by a
    // transfer or by leaving, not by being kicked.
    expect(
      denAffordances({
        target: target("OWNER"),
        viewer: viewer("OWNER"),
      }).canRemove
    ).toBe(false);
  });

  test("an Elder cannot remove the owner", () => {
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
    // Promotion changes who may add and remove, so letting an Elder promote would
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
    // Nor handed over: the den already has its owner, and the transfer route
    // refuses a target who holds it.
    expect(affordances.canTransferOwnership).toBe(false);
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

  test("only the owner may hand the den on", () => {
    // The transfer route is owner-only, so an Elder is never offered it. Same
    // reason promotion is owner-only, only with more at stake.
    for (const role of ["ADMIN", "MEMBER"] as const) {
      expect(
        denAffordances({
          target: target("MEMBER"),
          viewer: viewer(role),
        }).canTransferOwnership
      ).toBe(false);
    }
    expect(
      denAffordances({
        target: target("MEMBER"),
        viewer: viewer("OWNER"),
      }).canTransferOwnership
    ).toBe(true);
  });

  test("a hand-over is offered for any member who is not the owner and not you", () => {
    const owner = viewer("OWNER");
    // Either role on the roster: the service takes anybody in the den, so the
    // affordance must not be narrower than the route or the owner would have a
    // capability with no control.
    expect(
      denAffordances({ target: target("MEMBER"), viewer: owner })
        .canTransferOwnership
    ).toBe(true);
    expect(
      denAffordances({ target: target("ADMIN"), viewer: owner })
        .canTransferOwnership
    ).toBe(true);
    // Not yourself: the transfer route answers SELF_ACTION, and a button that can
    // only be refused is not drawn.
    expect(
      denAffordances({
        target: target("OWNER", true),
        viewer: owner,
      }).canTransferOwnership
    ).toBe(false);
    // Not the person who already owns it.
    expect(
      denAffordances({ target: target("OWNER"), viewer: owner })
        .canTransferOwnership
    ).toBe(false);
  });

  test("no row offers a hand-over to or by somebody who is not the owner", () => {
    for (const role of ["ADMIN", "MEMBER"] as const) {
      expect(
        denAffordances({
          target: target("ADMIN", true),
          viewer: viewer(role),
        }).canTransferOwnership
      ).toBe(false);
    }
  });
});

describe("denRoleAction", () => {
  test("a plain Member's row is the promotion, even when a hand-over is legal", () => {
    // The deliberate end of the ladder. Promotion is the cheap reversible step and
    // the only one whose absence removes a capability outright: if transfer
    // outranked it, every row would offer "hand over the den" and the owner could
    // never promote anybody again. The hand-over to a plain Member is still one
    // step away - promote, then hand over on the next row.
    expect(
      denRoleAction({
        affordances: denAffordances({
          target: target("MEMBER"),
          viewer: viewer("OWNER"),
        }),
        target: target("MEMBER"),
      })
    ).toEqual({ kind: "promote" });
  });

  test("an Elder's row is the hand-over rather than the kick or a demotion", () => {
    // Transfer outranks demote: the handover is what an owner wants for a row
    // that is already an Elder, and a demotion's outcome is reachable by
    // promoting somebody else. Both used to be "demote", so this assertion is the
    // record of the choice.
    expect(
      denRoleAction({
        affordances: denAffordances({
          target: target("ADMIN"),
          viewer: viewer("OWNER"),
        }),
        target: target("ADMIN"),
      })
    ).toEqual({ kind: "transfer" });
  });

  test("an Elder who cannot reassign roles falls back to removal", () => {
    // Nothing above it is legal for an Elder acting on a plain Member, so the kick
    // is the last rung - and it must never shadow a move that keeps them inside.
    expect(
      denRoleAction({
        affordances: denAffordances({
          target: target("MEMBER"),
          viewer: viewer("ADMIN"),
        }),
        target: target("MEMBER"),
      })
    ).toEqual({ kind: "remove" });
    expect(
      denRoleAction({
        affordances: denAffordances({
          target: target("ADMIN"),
          viewer: viewer("ADMIN"),
        }),
        target: target("ADMIN"),
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

  test("every viewer against every row yields at most one live action", () => {
    // The invariant the whole ladder exists for, asserted across the matrix rather
    // than on the two cases that used to exist: whatever the row and whoever is
    // looking at it, the answer is one action, and that action is one the row's
    // affordances actually allow. A new rung added above an existing one, or a
    // branch that matched after a live one had already returned, would show up
    // here as a menu offering something the route refuses.
    const roles = ["OWNER", "ADMIN", "MEMBER"] as const;
    const seen = new Set<string>();
    for (const viewerRole of roles) {
      for (const targetRole of roles) {
        for (const isSelf of [false, true]) {
          const affordances = denAffordances({
            target: target(targetRole, isSelf),
            viewer: viewer(viewerRole),
          });
          const live: Record<DenRoleActionKind, boolean> = {
            demote: affordances.canDemote,
            promote: affordances.canPromote,
            remove: affordances.canRemove,
            transfer: affordances.canTransferOwnership,
          };
          const action = denRoleAction({
            affordances,
            target: target(targetRole, isSelf),
          });
          if (action) {
            expect(live[action.kind]).toBe(true);
          } else {
            expect(live.remove).toBe(false);
          }
          seen.add(action?.kind ?? "none");
        }
      }
    }
    // And which rungs the ladder actually reaches. `demote` is missing on purpose:
    // the transfer sits above it, so a row that could be demoted is a row that can
    // be handed over instead. Naming the set keeps that from being undone by a
    // well-meaning reorder.
    expect([...seen].toSorted()).toEqual([
      "none",
      "promote",
      "remove",
      "transfer",
    ]);
  });

  test("the demote rung is only reachable for an owner looking at an Elder", () => {
    // Named because it is the one rung the ladder no longer reaches on its own:
    // transfer takes the Elder's row first. It stays in the union because
    // `canDemote` is the panel's authority question about that row, and a role
    // table that grew a second owner-capable role would make it live again.
    const demotes = denRoleAction({
      affordances: denAffordances({
        target: target("ADMIN"),
        viewer: viewer("OWNER"),
      }),
      target: target("ADMIN"),
    });
    expect(demotes).toEqual({ kind: "transfer" });
    expect(
      denAffordances({
        target: target("ADMIN"),
        viewer: viewer("OWNER"),
      }).canDemote
    ).toBe(true);
  });
});

describe("denRoleActionLabel", () => {
  test("every label names the product role, never the stored one", () => {
    // The stored value is ADMIN; the product word is Elder. A label that leaked the
    // stored value would be the whole regression this naming exists to prevent.
    expect(denRoleActionLabel({ action: "promote", memberName: "Ada" })).toBe(
      "Make Ada an Elder"
    );
    expect(denRoleActionLabel({ action: "demote", memberName: "Ada" })).toBe(
      "Remove Ada as Elder"
    );
    expect(denRoleActionLabel({ action: "transfer", memberName: "Ada" })).toBe(
      "Hand this den to Ada"
    );
    expect(denRoleActionLabel({ action: "remove", memberName: "Ada" })).toBe(
      "Remove Ada from den"
    );
    for (const action of ["demote", "promote", "remove", "transfer"] as const) {
      expect(denRoleActionLabel({ action, memberName: "Ada" })).not.toMatch(
        /admin/iu
      );
    }
  });

  test("the two removals cannot be mistaken for each other", () => {
    // "Remove X as Elder" and "Remove X from den" are opposite operations on
    // neighbouring rows, and the word "from den" is the only thing separating them.
    expect(
      denRoleActionLabel({ action: "demote", memberName: "Ada" })
    ).not.toBe(denRoleActionLabel({ action: "remove", memberName: "Ada" }));
  });

  test("a nameless member still gets a readable label", () => {
    expect(denRoleActionLabel({ action: "transfer", memberName: "  " })).toBe(
      "Hand this den to This person"
    );
  });

  test("every action has its own label, so no row is mislabelled", () => {
    const labels = (["demote", "promote", "remove", "transfer"] as const).map(
      (action) => denRoleActionLabel({ action, memberName: "Ada" })
    );
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("denViewerRoleLine", () => {
  test("says the reader's role in the product's words", () => {
    expect(denViewerRoleLine("OWNER")).toBe("you are owner");
    expect(denViewerRoleLine("ADMIN")).toBe("you are elder");
  });

  test("says nothing about a plain member", () => {
    // The same judgement the role chip makes. Naming the default state tells a
    // reader nothing they do not know from being in the room, and it makes the two
    // roles that grant something stop reading as special.
    expect(denViewerRoleLine("MEMBER")).toBeNull();
  });

  test("says nothing about somebody who is not on the roster", () => {
    expect(denViewerRoleLine(null)).toBeNull();
  });
});

describe("denRoleLabel", () => {
  test("names the elevated role Elder, not the stored ADMIN", () => {
    // The one place a role is shown to a person, so it is neither SCREAMING_SNAKE
    // the way the column is nor the column's own name. The stored value stays
    // ADMIN everywhere else: renaming it would rewrite every row to change a label.
    expect(denRoleLabel("OWNER")).toBe("Owner");
    expect(denRoleLabel("ADMIN")).toBe("Elder");
    expect(denRoleLabel("MEMBER")).toBe("Member");
  });
});

describe("DEN_ASSIGNABLE_ROLES", () => {
  test("ownership is not in the assignable set", () => {
    // Assigning a role moves one row; ownership also has to move the den's ownerId,
    // so the type excludes it rather than each call site remembering to check. The
    // route that does move it is the transfer one, which has its own confirmation.
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

  test("handing the den over names both outcomes, because both are true", () => {
    const copy = denConfirmCopy({
      kind: "transfer-ownership",
      memberName: "Ada",
    });
    expect(copy.title).toBe("Hand this den to Ada?");
    expect(copy.confirmLabel).toBe("Hand over to Ada");
    // What the other person gains, first: they become the one in charge, and the
    // power that comes with it is the part people are surprised by afterwards.
    expect(copy.description).toContain("Ada becomes the owner");
    expect(copy.description).toContain("can remove you");
    // And what the reader keeps, which is the part they cannot get back by asking.
    expect(copy.description).toContain("Elder");
    expect(copy.description).toContain("add and remove members");
    // The roles are named the way the product names them, never the way the column
    // stores them.
    expect(copy.description).not.toMatch(/admin/iu);
  });

  test("a nameless hand-over still reads", () => {
    const copy = denConfirmCopy({ kind: "transfer-ownership" });
    expect(copy.title).toBe("Hand this den to This person?");
    expect(copy.confirmLabel).toBe("Hand over to This person");
  });

  test("deleting the den is the only copy that promises nothing is kept", () => {
    const copy = denConfirmCopy({ kind: "delete-den" });
    expect(copy.title).toBe("Delete this den?");
    expect(copy.description).toContain("cannot be undone");
    // The removal copy must not be reused here: it promises the reader keeps
    // their history, which is the opposite of what dissolving means.
    expect(copy.description).not.toContain("stays on their device");
  });

  test("every confirm label is distinct, so no dialog is mislabelled", () => {
    const labels = new Set([
      denConfirmCopy({ kind: "delete-den" }).confirmLabel,
      denConfirmCopy({ kind: "leave-den" }).confirmLabel,
      denConfirmCopy({ kind: "remove-member", memberName: "Ada" }).confirmLabel,
      denConfirmCopy({ kind: "transfer-ownership", memberName: "Ada" })
        .confirmLabel,
    ]);
    expect(labels.size).toBe(4);
  });
});
