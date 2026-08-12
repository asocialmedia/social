"use server";

import {
  type UpdateUserProfileValues,
  updateUserProfileSchema,
} from "@asm/auth/validation";
import { getUserDataSelect, prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function updateUserProfile(values: UpdateUserProfileValues) {
  const validatedValues = updateUserProfileSchema.parse(values);
  const session = await getSessionFromApi();

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const updatedUser = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      displayName: validatedValues.displayName,
      bio: validatedValues.bio,
      githubUsername: validatedValues.githubUsername || null,
      linkedinUsername: validatedValues.linkedinUsername || null,
      twitterUsername: validatedValues.twitterUsername || null,
      redditUsername: validatedValues.redditUsername || null,
    },
    select: getUserDataSelect(session.user.id),
  });

  return updatedUser;
}
