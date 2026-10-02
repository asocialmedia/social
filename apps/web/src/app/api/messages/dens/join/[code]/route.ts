import {
  DenError,
  getDenMembership,
  joinDenByInviteCode,
  previewInvite,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { denErrorResponse } from "@/lib/messages/den-api";
import {
  DEN_JOIN_PREVIEW_RATE_LIMIT,
  DEN_JOIN_RATE_LIMIT,
  consumeDenRateLimit,
  denJoinPreviewIdentifier,
} from "@/lib/messages/den-rate-limit";
import { hasMessageIdentity } from "@/lib/messages/server";

interface Params {
  params: Promise<{ code: string }>;
}

// The one answer a code that cannot be used gets, whatever the reason.
//
// Three callers, one writer, on purpose. A preview 404, a join whose code no
// longer resolves, and a join refused because the den is full all reach the
// client as exactly these bytes. That identity is the point: a difference
// between them - a distinct status, a `code` field on one and not the other, a
// longer sentence - is a signal that a caller can sweep codes for, and the only
// caller that has any business receiving it is the one already holding a code
// and already told everything by the preview.
//
// It also covers a ROTATED code, which is the fourth caller and used to be the
// reason a stale link was a dead end. A rotation cannot be answered differently
// from here without turning this endpoint into the oracle the whole design is
// against; what it gets instead is the `expired` preview above, which a caller
// can only reach by holding a code the den really did issue.
function unusableCodeResponse(): Response {
  return Response.json(
    { code: "NOT_FOUND", error: "That join code is not valid" },
    { status: 404 }
  );
}

// The join screen. Read-only and deliberately thin: a name, a member count and
// nothing else.
//
// No roster, no message history, no member identities. Possession of a code is
// not a reason to enumerate who is in a den, so the preview carries only what a
// person needs to decide whether they want to join. A code that resolves to nothing
// answers 404, and the bytes are the same whatever the reason, so this endpoint
// cannot be used to test whether a guessed code was ever valid.
//
// A code that WAS rotated out is the one case that resolves, and it is a deliberate
// exception: it answers 200 with `expired` and the den's owner, so somebody holding
// a link whose code was rotated away under them can be told which den retired it and
// sent to the person who can mint a replacement. That is a real disclosure - the
// den's id, name, size and owner, where the live path returns the first three - and
// the reasoning for accepting it is that the reader was given this code by somebody
// in that den, so it names a room and a person they were already told about, and it
// hands back no way to get in. It stays narrow in two ways: it is gated on the code
// being one this den actually issued, and the owner is the minimum addition that
// makes the screen actionable. Nothing else about the den rides along; see the
// header of `previewRetiredInvite` for what must never be added to it.
//
// A code whose den has since been dissolved is answered as unknown rather than as an
// expired den with a missing owner: the archive cascades away with the
// conversation, so there is nothing to name, and a screen saying "hiding from us"
// about a room that no longer exists would be a worse lie than the unknown one.
export async function GET(request: Request, { params }: Params) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  const { code } = await params;

  // Metered per viewer, before the database is touched, so a rejected sweep
  // costs no query. Signed in, that is the account; signed out, it is the
  // ingress IP under a keyed hash, because this route needs no session and
  // "no session" must not mean "no limit". See `denJoinPreviewIdentifier`.
  const limited = await consumeDenRateLimit(
    DEN_JOIN_PREVIEW_RATE_LIMIT,
    denJoinPreviewIdentifier(request.headers, userId)
  );
  if (limited) {
    return limited;
  }

  try {
    const preview = await previewInvite(code);
    if (!preview) {
      return unusableCodeResponse();
    }
    // Membership is not disclosed to a signed-out viewer, so a code that leaked
    // tells an outsider nothing about whether its owner is still inside. Read once
    // for both shapes: an expired code carries the same field, and a member who
    // re-opens a link whose code has since rotated is exactly the person the
    // screen must not describe as an outsider.
    const membership = userId
      ? await getDenMembership(preview.id, userId)
      : null;
    if (preview.expired) {
      return Response.json({
        den: {
          id: preview.id,
          memberCount: preview.memberCount,
          name: preview.name,
          ownerId: preview.ownerId,
        },
        expired: true,
        isMember: membership !== null,
      });
    }
    return Response.json({
      den: {
        id: preview.id,
        memberCount: preview.memberCount,
        name: preview.name,
      },
      isMember: membership !== null,
    });
  } catch (error) {
    return denErrorResponse(error, { operation: "den.join.preview" });
  }
}

// Joins a den through its invite code.
//
// One rule difference from the direct add, and it is about following rather than
// about blocks. A direct add is gated on the caller following the people being
// added; arriving through a link is not, because the link exists precisely so
// somebody you do not follow can be brought in by somebody who does.
//
// Blocks used to be the second difference, checked at both doors, and are not any
// more. A den admits regardless of who blocks whom, at every door, so there is
// nothing to report and nothing to bury. See the header of
// `apps/web/src/lib/messages/blocks.ts` for why a pair's disagreement does not get
// to veto a room of ninety-eight other people.
//
// Re-opening a link you already joined through is a success, not a failure: the
// response says `alreadyMember` so the client navigates without an error toast.
export async function POST(_request: Request, { params }: Params) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { code } = await params;

  // Checked BEFORE the join, not after. A member with no message identity has
  // nothing to unwrap a root key with, so joining them would create a den they
  // can see the name of and read none of. Refusing first means the membership
  // row is never written and no cleanup is needed.
  if (!(await hasMessageIdentity(userId))) {
    return Response.json(
      { error: "Enable Messages first to join a den" },
      { status: 409 }
    );
  }

  // This is the widest door in the product - the URL is shareable and anyone
  // holding it can present it - so it carries the tightest membership-mutation
  // budget even though one person legitimately joins several dens a day.
  const limited = await consumeDenRateLimit(DEN_JOIN_RATE_LIMIT, userId);
  if (limited) {
    return limited;
  }

  try {
    const result = await joinDenByInviteCode(code, userId);
    return Response.json(
      {
        alreadyMember: result.alreadyMember,
        conversationId: result.id,
        ok: true,
      },
      // A join that only re-attached somebody already inside is not a new
      // resource, so it answers 200 while a real join answers 201.
      { status: result.alreadyMember ? 200 : 201 }
    );
  } catch (error) {
    // A full den is reported as a dead code, and that is deliberate.
    //
    // `denErrorResponse` maps LIMIT_REACHED to 409, which would answer "this code
    // is real and its den is full" - so a caller could sweep codes and read the
    // difference between 404 and 409 as a validity oracle. The code space makes
    // that impractical rather than impossible, and an oracle nobody has to guess
    // is not worth having. The information is not lost: the preview this screen
    // already fetched reports the member count, so the reader is told the den is
    // full before they press anything, and the client renders that state with no
    // action to take. What is removed is only the part the preview had not
    // already given away.
    if (error instanceof DenError && error.code === "LIMIT_REACHED") {
      return unusableCodeResponse();
    }
    // Everything else the join service can throw is a NOT_FOUND, which
    // `unusableCodeResponse` already covers, so in practice this line is
    // unreachable with a domain error at all. There is deliberately no 403 to
    // special-case any more: the only one this route used to produce was the block
    // refusal, and a den admits regardless of blocks, so `joinDenByInviteCode`
    // has no FORBIDDEN to throw.
    //
    // If a 403 ever does arrive from here - a future rule, or a proxy in front of
    // the app - it falls through to `denErrorResponse`, which forwards the
    // server's own message, and the client renders `denJoinFailure`'s
    // `unavailable` state: "That didn't come back from the server. Try again in a
    // moment." That is deliberately NOT `invalid`. A 403 here is not a dead code,
    // so telling the reader to ask for a new link would send them to chase
    // something that was never the problem, and it is not `rate-limited` either,
    // so naming the throttle would be a guess.
    return denErrorResponse(error, { operation: "den.join", userId });
  }
}
