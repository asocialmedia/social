import { getCommunityCreationQuota } from "@asm/db";

import {
  communityErrorResponse,
  requireApiUser,
} from "@/communities/api-response";

// The create-community gate reads this on open so the aura/ownership ladder is
// shown up front instead of surfacing as a failed submit at the end of the
// wizard. The server still re-checks the same rule atomically at write time, so
// this is a display affordance, never the enforcement point.
export async function GET(_request: Request) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }

  try {
    return Response.json(await getCommunityCreationQuota(user.userId));
  } catch (error) {
    return communityErrorResponse(error, {
      operation: "quota.read",
      slug: "creation-quota",
      userId: user.userId,
    });
  }
}
