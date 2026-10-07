import {
  DenError,
  getDenMembership,
  isCurrentDenMember,
  isDenBanned,
  isDenShortCode,
  joinDenByInviteCode,
  normalizeDenShortCode,
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

// The join screen. Read-only and deliberately thin: a name, a member count, the
// den's own image and nothing else.
//
// No roster, no message history, no member identities. Possession of a code is
// not a reason to enumerate who is in a den, so the preview carries only what a
// person needs to decide whether they want to join. A code that resolves to nothing
// answers 404, and the bytes are the same whatever the reason, so this endpoint
// cannot be used to test whether a guessed code was ever valid.
//
// The image is a fourth fact on the live path and is the same class as the name
// and the size: it identifies the room, it is not a roster, and the reader has to
// be able to tell whether the link they followed is the room somebody invited them
// to. The bytes come from this route's `avatar` endpoint rather than from
// `/api/media/{id}`, so the id above is not a second door: that route admits
// conversation members and refuses everybody else, and a non-member holding a code
// cannot turn it into a durable public URL.
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

  // SHORT CODES ARE THE SESSION-GATED HALF OF THIS DOOR, and the gate runs
  // BEFORE the limiter so an anonymous sweep of the 6-character space spends
  // neither its budget nor a database lookup.
  //
  // The preview's budgets were priced when the widest door was a 12-character
  // link code (31^12, unguessable): 30 reads an hour per identity was a
  // volumetric bound, not a guessing bound. A 6-character uppercase
  // alphanumeric code is ~2.2 billion possibilities and mints are bounded by
  // rotation budgets, so a pool of stolen sessions or IPv6 ranges makes a
  // sweep economically rational - and every hit discloses a den's name, size
  // and, on a retired or expired code, its owner. The owner disclosure in
  // `previewRetiredInvite` was priced for "only somebody the den invited is
  // holding this code"; a guessed short code breaks that premise.
  //
  // A LINK is still previewable signed out, because a link arrives in a chat
  // or an email and the person following it may not have an account yet - the
  // join screen exists for exactly that reader. A SHORT CODE has no such
  // arrival story: it is typed or pasted INTO the app, from the code tab of a
  // den the holder already has an account for. Gating it on a session costs
  // that flow nothing and removes the anonymous half of the sweep.
  //
  // The refusal must stay byte-identical to an unknown code so the gate
  // itself cannot become an oracle ("401 means it was worth trying"). It is
  // the same `unusableCodeResponse` every unresolvable code gets.
  if (!userId && isDenShortCode(normalizeDenShortCode(code))) {
    return unusableCodeResponse();
  }

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
    //
    // `isCurrentDenMember`, not "a row exists". Leaving and removal set `leftAt`
    // rather than deleting the row, so the row-exists reading answered `true` for
    // every departed member - which sent a kicked or departed person holding a live
    // link to "You're already in this den" instead of a Join offer. This is the one
    // definition of the field, on both shapes; a second one is how that happened.
    const membership = userId
      ? await getDenMembership(preview.id, userId)
      : null;
    const isMember = membership !== null && isCurrentDenMember(membership);
    if (preview.expired) {
      return Response.json({
        den: {
          id: preview.id,
          memberCount: preview.memberCount,
          name: preview.name,
          ownerId: preview.ownerId,
        },
        expired: true,
        isMember,
      });
    }
    // Whether THIS reader is banned, and only when they are. Never a false, and never
    // for anybody else: this answers one question about the account making the request
    // and cannot become a way to ask whether somebody else is excluded.
    //
    // Only for the LIVE path, and that is a product rule rather than a privacy one. A
    // retired code's screen exists to send somebody to the owner who can mint a
    // replacement, and telling a banned person "you are also banned, never mind" on a
    // dead link tells them nothing they could not learn and costs the screen the one
    // thing it is for.
    const banned = userId ? await isDenBanned(preview.id, userId) : false;
    return Response.json({
      den: {
        // The den's own image, on the live path only. `previewInvite` already
        // refuses to carry one for a retired code, so this branch cannot leak it
        // into the expired shape above even by accident.
        avatarMediaId: preview.avatarMediaId,
        id: preview.id,
        memberCount: preview.memberCount,
        name: preview.name,
      },
      isBanned: banned,
      isMember,
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
    // A ban is the one refusal this door forwards rather than collapsing, and the
    // reason is the reader: they already hold a live code for this den, so telling them
    // the code works and they are still not welcome discloses nothing they could not
    // learn by pressing the button - and it is the only way they learn WHY. Collapsing
    // it into `unusableCodeResponse` would answer a banned person with "this link is cut
    // short, mistyped, or points to a den that's gone", which sends them to check a
    // link that is perfectly fine.
    if (error instanceof DenError && error.code === "BANNED") {
      return Response.json(
        { code: "BANNED", error: error.message },
        { status: 403 }
      );
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
