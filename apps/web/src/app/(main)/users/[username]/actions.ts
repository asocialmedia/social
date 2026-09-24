"use server";

import { updateUserProfileSchema } from "@asm/auth/validation";
import type { UpdateUserProfileValues } from "@asm/auth/validation";
import { getUserDataQuery, mapUserData, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function updateUserProfile(values: UpdateUserProfileValues) {
  const validatedValues = updateUserProfileSchema.parse(values);
  const session = await getSessionFromApi();

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  await prisma.orm.public.Users.where({ id: session.user.id }).update({
    bio: validatedValues.bio,
    customDomain: validatedValues.customDomain || null,
    displayName: validatedValues.displayName,
    githubUsername: validatedValues.githubUsername || null,
    linkedinUsername: validatedValues.linkedinUsername || null,
    redditUsername: validatedValues.redditUsername || null,
    twitterUsername: validatedValues.twitterUsername || null,
  });
  const updatedUser = await getUserDataQuery(prisma.orm, session.user.id)
    .where({ id: session.user.id })
    .first();

  return updatedUser ? mapUserData(updatedUser) : null;
}
