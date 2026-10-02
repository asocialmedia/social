import {
  canManageDen,
  prisma,
  requireDenMembership,
  updateDenDetails,
} from "@asm/db";

import {
  denErrorResponse,
  objectOf,
  optionalStringField,
  requireApiUser,
} from "@/lib/messages/den-api";
import {
  DEN_DETAILS_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";

interface Params {
  params: Promise<{ id: string }>;
}

// The den's own shape, for the details panel: name, description, avatar, the
// invite code (managers only, since the code is the door), and the caller's role
// so the panel can decide which affordances to render without a second call.
export async function GET(_request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id } = await params;

  try {
    // requireDenMembership is the gate: it refuses a non-member and refuses a
    // DM, so this cannot become a way to read somebody's private thread.
    const membership = await requireDenMembership(id, user.userId);
    const [den, members] = await Promise.all([
      prisma.orm.public.MessageConversations.select(
        "avatarMediaId",
        "description",
        "inviteCode",
        "name",
        "ownerId"
      )
        .where({ id })
        .first(),
      prisma.orm.public.MessageConversationMembers.where((member) =>
        member.conversationId.eq(id)
      ).aggregate((aggregate) => ({ count: aggregate.count() })),
    ]);
    if (!den) {
      return Response.json({ error: "Den not found" }, { status: 404 });
    }
    // The same predicate the server's own management gate authorizes with, and
    // the same one `den-permissions.ts` decides which controls to draw from. It
    // used to be written out here as `role === "OWNER" || role === "ADMIN"`, which
    // is a third copy of the role table in a file whose whole job is to be the
    // truth about the den: a role added to the table would light up the panel's
    // controls, pass `requireDenManager`, and then be reported here as
    // `canManage: false`, so the invite controls would vanish for the one person
    // who has them.
    const canManage = canManageDen(membership.role);
    return Response.json({
      canManage,
      den: {
        avatarMediaId: den.avatarMediaId,
        description: den.description,
        // The invite code is the ability to add strangers, so it is withheld
        // from plain members even though they can see the den exists.
        inviteCode: canManage ? den.inviteCode : null,
        memberCount: members.count,
        name: den.name,
        ownerId: den.ownerId,
      },
      membership,
    });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.get",
      userId: user.userId,
    });
  }
}

// Renames a den, changes its description, or swaps its avatar.
//
// PATCH rather than PUT because the fields are independent: a client renaming a
// den must not have to resend the description it did not mean to change, and a
// field that is absent is left alone while a field sent as null is cleared.
export async function PATCH(request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id } = await params;

  const body = objectOf(await request.json().catch(() => null));
  if (!body) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const input: {
    avatarMediaId?: string | null;
    description?: string | null;
    name?: string;
  } = {};

  const name = optionalStringField(body, "name");
  if (!name.ok) {
    return Response.json({ error: "name must be a string" }, { status: 400 });
  }
  if (name.value !== undefined && name.value !== null) {
    input.name = name.value;
  }

  const description = optionalStringField(body, "description");
  if (!description.ok) {
    return Response.json(
      { error: "description must be a string" },
      { status: 400 }
    );
  }
  if (description.value !== undefined) {
    input.description = description.value;
  }

  const avatarMediaId = optionalStringField(body, "avatarMediaId");
  if (!avatarMediaId.ok) {
    return Response.json(
      { error: "avatarMediaId must be a string" },
      { status: 400 }
    );
  }
  if (avatarMediaId.value !== undefined) {
    input.avatarMediaId = avatarMediaId.value;
  }

  if (Object.keys(input).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const limited = await consumeDenRateLimit(
    DEN_DETAILS_RATE_LIMIT,
    user.userId
  );
  if (limited) {
    return limited;
  }

  try {
    await updateDenDetails(id, user.userId, input);
    return Response.json({ ok: true });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.update",
      userId: user.userId,
    });
  }
}
