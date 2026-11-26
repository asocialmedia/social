import { canViewCommunity, getCommunityBySlug } from "@asm/db";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getSessionFromApi } from "@/lib/auth/session";

export const getCommunityWorkspaceAccess = cache(async (slug: string) => {
  const [community, session] = await Promise.all([
    getCommunityBySlug(slug),
    getSessionFromApi(),
  ]);
  if (!community) {
    notFound();
  }
  const userId = session?.user?.id ?? "";
  return {
    canRead: await canViewCommunity(community, userId),
    community,
    userId,
  };
});
