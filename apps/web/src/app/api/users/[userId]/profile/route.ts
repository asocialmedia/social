import { updateUserProfileSchema } from "@asm/auth/validation";
import type { UpdateUserProfileValues } from "@asm/auth/validation";
import { getUserDataSelect, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  const { userId } = await ctx.params;
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user || user.id !== userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Strict field allowlist: a raw body spread into prisma.user.update would
  // let the caller write role, banned, email or passwordHash on their own row.
  let parsedValues: Partial<UpdateUserProfileValues>;
  try {
    parsedValues = updateUserProfileSchema
      .partial()
      .parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid profile values" }, { status: 400 });
  }

  const data: Partial<{
    bio: string;
    displayName: string;
    githubUsername: string | null;
    linkedinUsername: string | null;
    redditUsername: string | null;
    twitterUsername: string | null;
  }> = {};
  if (parsedValues.bio !== undefined) {
    data.bio = parsedValues.bio;
  }
  if (parsedValues.displayName !== undefined) {
    data.displayName = parsedValues.displayName;
  }
  if (parsedValues.githubUsername !== undefined) {
    data.githubUsername = parsedValues.githubUsername || null;
  }
  if (parsedValues.linkedinUsername !== undefined) {
    data.linkedinUsername = parsedValues.linkedinUsername || null;
  }
  if (parsedValues.redditUsername !== undefined) {
    data.redditUsername = parsedValues.redditUsername || null;
  }
  if (parsedValues.twitterUsername !== undefined) {
    data.twitterUsername = parsedValues.twitterUsername || null;
  }

  if (Object.keys(data).length === 0) {
    return Response.json(
      { error: "No valid profile fields provided" },
      { status: 400 }
    );
  }

  await prisma.user.update({
    data,
    select: getUserDataSelect(user.id),
    where: { id: user.id },
  });

  return Response.json({ success: true });
}
