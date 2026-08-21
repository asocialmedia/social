import { getPrivateUserSelect, prisma } from "@asm/db";
import { cache } from "react";

// The logged-in user's own data: private fields (storage keys, provider ids,
// email) are only ever returned for the session owner and never embedded in
// public profile payloads.
export const getUserData = cache(async (userId: string) => {
  const userData = await prisma.user.findUnique({
    select: getPrivateUserSelect(userId),
    where: { id: userId },
  });

  return userData;
});
