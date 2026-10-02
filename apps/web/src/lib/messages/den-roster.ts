import { DEN_LIMITS } from "@asm/db";

import {
  areUsersMissingMessageIdentity,
  areUsersNotFollowedBy,
  doUsersExist,
} from "./den-candidates";

// Validates a proposed den roster. Split out from the route so the rules are
// testable without a database and so the create and add routes cannot drift
// apart on what counts as a legal member set.
//
// The order is deliberate: cheapest and most specific first, so the message a
// user sees names the actual problem rather than a downstream symptom. A missing
// account is reported as missing, not as "you don't follow them".
//
// What is deliberately absent is any block rule. Dens admit regardless of blocks:
// a den is a room of up to DEN_LIMITS.membersMax people, refusing one because two
// of them disagree cost the other ninety-eight their room, and the refusal was
// all-or-nothing over the whole roster. `DenCandidateFailureCode` below has no
// BLOCKED member for the same reason `DenError` has no BLOCKED code, and
// `options.currentMemberIds` is gone with it: the only question the roster needed
// it for was "would this candidate be put in a room with somebody they have a
// block with", and nobody asks that. See the header of `./blocks.ts`.

export type DenCandidateFailureCode =
  | "FOLLOW_REQUIRED"
  | "INVALID_INPUT"
  | "LIMIT_REACHED"
  | "MEMBERS_REQUIRED"
  | "NOT_FOUND"
  | "NO_IDENTITY";

export interface DenCandidateFailure {
  code: DenCandidateFailureCode;
  error: string;
}

// HTTP status per code, matching the split denErrorResponse uses: 400 for a
// malformed request, 404 for something that does not exist, 409 for a rule the
// caller's own state is already violating.
const FAILURE_STATUS: Record<DenCandidateFailureCode, number> = {
  FOLLOW_REQUIRED: 403,
  INVALID_INPUT: 400,
  LIMIT_REACHED: 409,
  MEMBERS_REQUIRED: 400,
  NOT_FOUND: 404,
  NO_IDENTITY: 409,
};

export function denCandidateFailureResponse(
  failure: DenCandidateFailure
): Response {
  return Response.json(
    { code: failure.code, error: failure.error },
    { status: FAILURE_STATUS[failure.code] }
  );
}

// Normalizes the raw body field into a clean id list, or reports the shape
// error. A non-array, or an array holding a non-string, is a malformed request
// rather than an empty roster, so the two must not collapse into one answer.
export function parseMemberIds(
  value: unknown
):
  | { failure: null; memberIds: string[] }
  | { failure: DenCandidateFailure; memberIds: null } {
  if (value === undefined || value === null) {
    return { failure: null, memberIds: [] };
  }
  if (!Array.isArray(value)) {
    return {
      failure: { code: "INVALID_INPUT", error: "memberIds must be a list" },
      memberIds: null,
    };
  }
  if (value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    return {
      failure: { code: "INVALID_INPUT", error: "memberIds must hold user ids" },
      memberIds: null,
    };
  }
  // Sorted and deduped so two clients proposing the same roster in a different
  // order produce byte-identical validation and identical writes.
  return {
    failure: null,
    memberIds: [...new Set(value as string[])].toSorted(),
  };
}

// Checks everything about a proposed roster that does not need a transaction:
// existence, message identity and the follow relationship.
//
// `requireFollow` distinguishes the two doors. A direct add is a deliberate act
// against people the caller already follows, matching the DM rule. An
// invite-link join is not: the point of a shareable link is that somebody the
// inviter does not follow can be brought in by somebody who does, so the follow
// check does not apply at that door. Following is the one door rule that survives
// the change that removed the block one - it is about the ACT, and the two acts
// genuinely differ.
//
// `currentMemberCount` is the den's size before the addition, or 0 when creating.
// The cap is checked here for a fast, friendly answer; the service re-checks it
// under its claim lock, because this read is not atomic with the write.
export async function validateDenRoster(
  actorId: string,
  memberIds: string[],
  options: {
    currentMemberCount: number;
    requireFollow: boolean;
  }
): Promise<DenCandidateFailure | null> {
  // The actor is always a member, so they are never "missing" or "unfollowed",
  // and listing them explicitly is a no-op rather than an error.
  const others = memberIds.filter((id) => id !== actorId);
  const total = options.currentMemberCount + others.length;

  if (total > DEN_LIMITS.membersMax) {
    return {
      code: "LIMIT_REACHED",
      error: `A den can have at most ${DEN_LIMITS.membersMax} members`,
    };
  }
  if (others.length === 0) {
    return {
      code: "MEMBERS_REQUIRED",
      error: "Add at least one other person",
    };
  }

  const missing = await doUsersExist(others);
  if (missing.length > 0) {
    return {
      code: "NOT_FOUND",
      error: "Some of those accounts no longer exist",
    };
  }

  // Checked before the follow rule so somebody without Messages enabled gets the
  // actionable message rather than being told to follow them first.
  const withoutIdentity = await areUsersMissingMessageIdentity(others);
  if (withoutIdentity.length > 0) {
    return {
      code: "NO_IDENTITY",
      error: "Some of those people haven't enabled Messages yet",
    };
  }

  if (options.requireFollow) {
    const unfollowed = await areUsersNotFollowedBy(actorId, others);
    if (unfollowed.length > 0) {
      return {
        code: "FOLLOW_REQUIRED",
        error: "You can only add people you follow",
      };
    }
  }

  return null;
}
