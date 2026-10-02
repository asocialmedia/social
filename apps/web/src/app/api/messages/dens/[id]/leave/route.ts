import { dissolveDen, leaveDen } from "@asm/db";

import { denErrorResponse, requireApiUser } from "@/lib/messages/den-api";
import {
  DEN_DISSOLVE_RATE_LIMIT,
  DEN_MANAGE_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";

interface Params {
  params: Promise<{ id: string }>;
}

// Leaves a den.
//
// The response says what happened to the den, because the client's next move
// depends on it: a dissolved den has nowhere to navigate back to, while a
// transferred one stays open under somebody else's ownership. `newOwnerId` is
// only ever the caller's own successor, so returning it leaks nothing about the
// roster to the person leaving.
export async function POST(_request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id } = await params;

  // A member walking out is not abuse, but it is a mutation, so it shares the
  // manage budget rather than being unmetered.
  const limited = await consumeDenRateLimit(DEN_MANAGE_RATE_LIMIT, user.userId);
  if (limited) {
    return limited;
  }

  try {
    const result = await leaveDen(id, user.userId);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.leave",
      userId: user.userId,
    });
  }
}

// Dissolves the den outright. Owner only, and separate from `leave` on purpose:
// it is the only operation here that is not undoable, because the conversation
// row owns the messages, the key wraps and every member's read watermark.
export async function DELETE(_request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id } = await params;

  const limited = await consumeDenRateLimit(
    DEN_DISSOLVE_RATE_LIMIT,
    user.userId
  );
  if (limited) {
    return limited;
  }

  try {
    await dissolveDen(id, user.userId);
    return Response.json({ ok: true });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.delete",
      userId: user.userId,
    });
  }
}
