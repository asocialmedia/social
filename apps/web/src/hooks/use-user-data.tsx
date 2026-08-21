import { getPrivateUserSelect, prisma } from "@asm/db";
import { cache } from "react";

import { getSessionFromApi } from "@/lib/session";

// The logged-in user's own data: private fields (storage keys, provider ids,
// email) are only ever returned for the session owner and never embedded in
// public profile payloads. The session is re-checked here so a caller can
// never fetch private fields for an arbitrary userId.
export const getUserData = cache(async (userId: string) => {
  const session = await getSessionFromApi();
  if (!session?.user || session.user.id !== userId) {
    return null;
  }

  const userData = await prisma.user.findUnique({
    select: getPrivateUserSelect(userId),
    where: { id: userId },
  });

  return userData;
});
