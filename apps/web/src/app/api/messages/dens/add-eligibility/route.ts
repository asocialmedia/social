import { DEN_LIMITS } from "@asm/db";

import { requireApiUser } from "@/lib/messages/den-api";
import { groupAddEligibility } from "@/lib/messages/den-candidates";

// Whether the viewer may put each of these accounts in a group, and why not.
//
// The den search already answers this per query, but the picker's RECENTS are
// people you already talk to, and they come from the conversation list, which
// carries no group-add policy and should not start: it is the hot payload behind
// every conversation screen, and a privacy setting has no business in it.
//
// So this is the same decision, asked about a set the client already holds. One
// bulk read per open picker rather than per person, capped at the den ceiling so
// the ids cannot be used to sweep the column.
const MAX_IDS = DEN_LIMITS.membersMax;

export async function GET(request: Request) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }

  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").map((id) => id.trim()))].filter(
    (id) => id.length > 0
  );

  if (ids.length > MAX_IDS) {
    return Response.json(
      { error: "Too many accounts at once" },
      { status: 400 }
    );
  }

  const eligibility = await groupAddEligibility(user.userId, ids);

  // One entry per requested id, including the ones with no row here. A missing
  // account is reported as addable rather than omitted, because the caller
  // already has its own existence rule and this route has no opinion about it.
  return Response.json({
    eligibility: ids.map((id) => ({
      id,
      refusal: eligibility.get(id) ?? null,
    })),
  });
}
