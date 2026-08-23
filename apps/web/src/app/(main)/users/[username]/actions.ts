"use server";

import { updateUserProfileSchema } from "@asm/auth/validation";
import type { UpdateUserProfileValues } from "@asm/auth/validation";
import { getUserDataSelect, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function updateUserProfile(values: UpdateUserProfileValues) {
  const validatedValues = updateUserProfileSchema.parse(values);
  const session = await getSessionFromApi();

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const updatedUser = await prisma.user.update({
    data: {
      bio: validatedValues.bio,
      customDomain: validatedValues.customDomain || null,
      displayName: validatedValues.displayName,
      githubUsername: validatedValues.githubUsername || null,
      linkedinUsername: validatedValues.linkedinUsername || null,
      redditUsername: validatedValues.redditUsername || null,
      twitterUsername: validatedValues.twitterUsername || null,
    },
    select: getUserDataSelect(session.user.id),
    where: { id: session.user.id },
  });

  return updatedUser;
}
