import { getUserDataSelect, prisma } from "@asm/db";
import { cache } from "react";

export const getUserData = cache(async (userId: string) => {
  const userData = await prisma.user.findUnique({
    select: getUserDataSelect(userId),
    where: { id: userId },
  });

  return userData;
});
