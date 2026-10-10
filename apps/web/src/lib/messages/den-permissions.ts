// Which den controls the UI is allowed to draw, and for which member.
//
// The server is the authority on every one of these: `requireDenManager` and
// `requireDenOwner` run before any den mutation touches a row, and a role change
// an hour ago is invisible to a panel that has been open since. What this
// module decides is narrower and purely about the UI's obligation to "not offer
// what will be refused" — so it is built on `canManageDen` and `canManageRole`
// from `@asm/db`, the same helpers the server's rules are expressed in, rather
// than on a second copy of the role table written out here.
//
// Two facts therefore have to agree for anything to be drawn: the role the
// detail route reported, and the `canManage` flag it reported alongside. They
// come from the same row and the same request, so requiring both means a panel
// opened against a half-stale response offers nothing rather than offering
// something the route will refuse.
//
// Nothing here is a security control. Every mutation re-checks, and this only
// decides what a person is shown.

// The browser-safe subpath, not the `@asm/db` barrel: these are runtime values
// and the barrel drags the Prisma client into the client bundle. The rule this
// module decides with is the same function the server authorizes with.
import type { DenRole } from "@asm/db/messages/dens";
import { canManageDen, canManageRole } from "@asm/db/messages/dens";

import { denBanConfirmCopy, denUnbanConfirmCopy } from "./den-ban-copy";

// The role a member holds, as the detail route reports it.
export interface DenViewerRole {
  canManage: boolean;
  role: DenRole | null;
}

// The roster row a control is being asked about. Self is a separate question
// from role, because a role string cannot tell the owner from any other member
// who happens to share it — only the id can.
export interface DenAffordanceTarget {
  isSelf: boolean;
  role: DenRole;
}

export interface DenAffordances {
  canAddMembers: boolean;
  // Manager-wide, because the banned list is a section rather than a per-row control.
  // Read here and asserted in `den-ban-copy.test.ts` against the same conditions as
  // `canRemove`, so the two can never be offered for one row and not the other.
  canBanMembers: boolean;
  canCopyInvite: boolean;
  canDeleteDen: boolean;
  // Per-target, so the caller reads one object for the row it is drawing.
  canDemote: boolean;
  canLeave: boolean;
  canPromote: boolean;
  canRemove: boolean;
  canRename: boolean;
  canRotateInvite: boolean;
  canSetRole: boolean;
  // Per-target, and owner-only: it moves who is in charge, so the transfer route
  // checks the same thing this does.
  canTransferOwnership: boolean;
}

// What a den-wide control needs: manager rights, read off the role the server
// reported AND cross-checked against the flag it reported. Both, on purpose.
function isManager(viewer: DenViewerRole): boolean {
  return viewer.canManage && canManageDen(viewer.role ?? "");
}

export function denAffordances(input: {
  target?: DenAffordanceTarget | null;
  viewer: DenViewerRole;
}): DenAffordances {
  const { viewer } = input;
  const target = input.target ?? null;
  const manage = isManager(viewer);
  const isOwner = viewer.role === "OWNER";

  // Nobody off the roster has anything to do to this den, and the route would
  // answer 403 for all of it, so the whole set is empty rather than partial.
  const member = viewer.role !== null;

  // Self-action is refused by every route that takes a target (use `leave`
  // instead), and the owner's role cannot be assigned at all, so a row about the
  // owner never offers a role control.
  const targetIsActionable =
    target !== null && !target.isSelf && target.role !== "OWNER";

  // `canSetRole` is owner-only, matching the route: promotion changes who may
  // add and remove members, so an elder promoting somebody would be handing out
  // their own permissions.
  const canSetRole = isOwner && targetIsActionable;

  return {
    // Adding is a management act, not an owner one: an elder adding somebody is
    // the whole reason the role exists.
    canAddMembers: manage,
    // The banned list, for the same reason `canAddMembers` is `manage` rather than
    // owner-only: it is a moderation tool rather than a control over the room itself,
    // and an Elder who can remove somebody can certainly be told they may not rejoin.
    // The route re-checks with `requireDenManager`, so this only decides what is drawn.
    canBanMembers: manage,
    // Withheld from plain members by the server (the code IS the door), so the
    // panel only offers the copy when it actually holds a code.
    canCopyInvite: manage,
    // Dissolving is the one thing the owner alone can do, and the only operation
    // in the den that is not undoable.
    canDeleteDen: isOwner,
    canDemote: canSetRole && target?.role === "ADMIN",
    canLeave: member,
    canPromote: canSetRole && target?.role === "MEMBER",
    // Removal has one rule the role comparison does not: the owner cannot be
    // removed, not even by another owner. `canManageRole` allows an owner to act
    // on an owner because that is right for a generic role question; the den has
    // exactly one owner and ownership moves by a transfer or by leaving, so the
    // remove route refuses it outright. Both guards are therefore required here.
    canRemove:
      manage &&
      target !== null &&
      !target.isSelf &&
      target.role !== "OWNER" &&
      canManageRole(viewer.role ?? "", target.role),
    canRename: manage,
    canRotateInvite: manage,
    canSetRole,
    // The same three conditions a promotion needs, because a transfer is the same
    // owner-only move with a heavier consequence: somebody else has to be in the
    // den already (the transfer route refuses a non-member with NOT_FOUND), it
    // cannot be aimed at the reader (SELF_ACTION, "you already own this den"), and
    // it cannot be aimed at the person who already owns the den.
    canTransferOwnership:
      canSetRole && target !== null && target.role !== "OWNER",
  };
}

// The one place the product's words for the roles live.
//
// `Record<DenRole, string>` rather than a function with a switch, so a fourth
// role is a compile error here rather than a chip that renders its stored name.
// The stored value and the spoken one differ on purpose: the database says ADMIN
// because that column predates the product naming, and renaming it would rewrite
// every row to change a label. Nothing outside the display layer should ever
// print a stored role.
const ROLE_LABEL: Record<DenRole, string> = {
  ADMIN: "Elder",
  MEMBER: "Member",
  OWNER: "Owner",
};

export function denRoleLabel(role: DenRole): string {
  return ROLE_LABEL[role];
}

// The reader's own role, in a sentence a header can drop in after a middot.
//
// Null for a plain member, and that is the same judgement the role chip makes:
// naming the default state tells a reader nothing they do not already know from
// being in the room, and it makes the two roles that grant something - Elder and
// Owner - stop reading as special. `role` is nullable because the details header
// renders for somebody who is not on the roster at all (a preview, a den whose
// roster has not resolved), and it has nothing to say in that case either.
export function denViewerRoleLine(role: DenRole | null): string | null {
  if (role === null || role === "MEMBER") {
    return null;
  }
  return `you are ${denRoleLabel(role).toLowerCase()}`;
}

// A role a manager can assign. Ownership is deliberately absent and the type
// says so, so a call site cannot offer "make this person the owner" and have to
// remember to check. Assigning a role moves one row; ownership moves `ownerId`
// with it, which is what `transferDenOwnership` and its confirmation are for.
export const DEN_ASSIGNABLE_ROLES = ["ADMIN", "MEMBER"] as const;

export type DenAssignableRole = (typeof DEN_ASSIGNABLE_ROLES)[number];

// What a roster row's role control can offer, given what the affordances allow.
//
// `ban` joins `remove` rather than replacing it, and that is the point of the whole
// feature: they are two decisions, not a severity range. "Remove" ends access now and
// says nothing about the future, which is the right tool for somebody removed in
// error. "Ban" closes the door as well, and is the only answer to somebody removed on
// purpose - because the invite link they were given is still live.
export type DenRoleActionKind =
  | "ban"
  | "demote"
  | "promote"
  | "remove"
  | "transfer";

// Every legal action for one row, in the order the menu draws them.
//
// This used to return at most one action, on the reasoning that a row offering
// "hand over the den" did not also need "demote" beside it. That was wrong in a
// way the affordances already knew: for an owner looking at an Elder, `canDemote`
// and `canRemove` are both true while `canTransferOwnership` is true too, so
// collapsing to the first match left the owner with no way to demote somebody or
// kick them at all. Not offering an operation the server performs perfectly well
// is not restraint, it is a missing capability with a comment defending it.
//
// So every legal action is returned, and the only question left is the order.
//
// Promote leads because it is the cheap reversible step. Transfer follows it
// because handing a Member the den is a two-step move, and doing it from the
// Member's row skips the promotion they would otherwise be offered first.
//
// Demote sits next to remove on purpose: "Remove Ada as Elder" and "Remove Ada
// from den" are opposite operations, and putting the two that share the word
// "Remove" next to each other is what keeps them from being read as the same one.
//
// Remove sits second-last and ban last. They are the only two actions here that take
// a person out of the den, and a destructive entry never leads a menu. Ban is the
// heavier of the pair - it ends access AND closes the door - so it is the one that
// goes last, where it cannot be reached by a reflex.
export function denRowActions(input: {
  affordances: DenAffordances;
  target: DenAffordanceTarget;
}): DenRoleActionKind[] {
  const { affordances, target } = input;
  const actions: DenRoleActionKind[] = [];
  if (affordances.canPromote && target.role === "MEMBER") {
    actions.push("promote");
  }
  if (affordances.canTransferOwnership && target.role === "ADMIN") {
    actions.push("transfer");
  }
  if (affordances.canDemote && target.role === "ADMIN") {
    actions.push("demote");
  }
  if (affordances.canRemove) {
    actions.push("remove");
  }
  // Ban after remove, and the two adjacent on purpose. Both take a person out of the
  // den and they differ only in whether the door is left open, so the pair is drawn
  // together: a reader who wants "they cannot come back" sees both words side by side
  // and has to choose, rather than finding one buried. Gated on `canRemove` rather than
  // its own flag so the two can never come apart - a row offering "Ban" without
  // offering "Remove" would be an authority the server does not have.
  if (affordances.canRemove) {
    actions.push("ban");
  }
  return actions;
}

// The menu trigger's accessible name.
//
// One action names itself, because a button whose label says nothing about what
// pressing it does is a button a screen reader announces as a mystery: a row with
// only a removal reads "Remove Ada from den", not "Manage Ada".
//
// More than one action cannot name itself, because a name can only describe one of
// them and picking the first would describe an operation the owner did not choose.
// So the menu names its subject instead.
export function denRowMenuLabel(input: {
  actions: DenRoleActionKind[];
  memberName: string;
}): string {
  const name = input.memberName.trim() || "This person";
  if (input.actions.length === 1) {
    return denRoleActionLabel({
      action: input.actions[0],
      memberName: name,
    });
  }
  return `Manage ${name}`;
}

// The menu entry's text, and the trigger's name when a row has exactly one
// action, both here for the same reason `denConfirmCopy` is: the wording is
// assertable without rendering a Radix menu, and it cannot drift between the
// visible label and the name a screen reader announces for the button that opens
// it.
//
// "Remove Ada as Elder" against "Remove Ada from den" on neighbouring rows is the
// one ambiguity worth writing down. They mean opposite things - revoke the role,
// versus remove the person - and the word "from den" is what tells them apart.
export function denRoleActionLabel(input: {
  action: DenRoleActionKind;
  memberName: string;
}): string {
  const name = input.memberName.trim() || "This person";
  if (input.action === "promote") {
    return `Make ${name} an Elder`;
  }
  if (input.action === "demote") {
    return `Remove ${name} as Elder`;
  }
  if (input.action === "transfer") {
    return `Hand this den to ${name}`;
  }
  if (input.action === "ban") {
    return `Ban ${name} from den`;
  }
  return `Remove ${name} from den`;
}

// The confirmation copy for a den action a person has to agree to. It lives here
// rather than in the dialog so the four paths (remove a member, leave, transfer
// the den, delete the den) cannot drift apart in tone, and so the copy is
// assertable without rendering a dialog.
//
// They say what is lost and who keeps what. Removing a member is not the same as
// deleting a den, and handing the den to somebody is not the same as either: it
// is the one confirmation where the reader gives up more authority than they keep
// and the other person gains more than they lose, so both halves are named.
export function denConfirmCopy(input: {
  kind:
    | "ban-member"
    | "delete-den"
    | "leave-den"
    | "remove-member"
    | "transfer-ownership"
    | "unban-member";
  memberName?: string | null;
}): { confirmLabel: string; description: string; title: string } {
  if (input.kind === "remove-member") {
    const name = input.memberName?.trim() || "This person";
    return {
      confirmLabel: `Remove ${name}`,
      description: `${name} loses access to this den immediately. Everything they have already read stays on their device, and they can't read anything sent from now on.`,
      title: `Remove ${name}?`,
    };
  }
  if (input.kind === "ban-member") {
    // The copy lives in `den-ban-copy.ts` beside the other ban wording rather than
    // here, because there is a lot of it and it is all about one subject; a copy deck
    // is a worse home for it than the file that owns the feature.
    return denBanConfirmCopy(input.memberName);
  }
  if (input.kind === "unban-member") {
    return denUnbanConfirmCopy(input.memberName);
  }
  if (input.kind === "leave-den") {
    return {
      confirmLabel: "Leave den",
      description:
        "You'll stop getting messages from this den. If you are the owner, it passes to the longest-standing member.",
      title: "Leave this den?",
    };
  }
  if (input.kind === "transfer-ownership") {
    const name = input.memberName?.trim() || "This person";
    return {
      confirmLabel: `Hand over to ${name}`,
      // Both outcomes, in that order, because both are true at once and the
      // second is the one that surprises people: they lose the ability to
      // dissolve the den and to remove anybody, and they do not get it back by
      // asking nicely.
      description: `${name} becomes the owner of this den and can remove you from it, rename it, or delete it. You'll stay in as an Elder, so you can still add and remove members.`,
      title: `Hand this den to ${name}?`,
    };
  }
  return {
    confirmLabel: "Delete den",
    description:
      "The den, its messages and its history are deleted for everyone. This cannot be undone.",
    title: "Delete this den?",
  };
}
