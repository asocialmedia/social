"use server";

import {
  type UpdateUserProfileValues,
  updateUserProfileSchema,
} from "@asm/auth/validation";
import { getUserDataSelect, prisma } from "@asm/db";
import { authClient } from "@/lib/auth";

export async function updateUserProfile(values: UpdateUserProfileValues) {
  const validatedValues = updateUserProfileSchema.parse(values);
  const session = await authClient.getSession();

  if (!session?.data?.user) {
    throw new Error("Unauthorized");
  }

  const updatedUser = await prisma.user.update({
    where: { id: session.data.user.id },
    data: validatedValues,
    select: getUserDataSelect(session.data.user.id),
  });

  return updatedUser;
}
