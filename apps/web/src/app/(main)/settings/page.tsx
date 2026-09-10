import { getPrivateUserSelect, prisma } from "@asm/db";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import type { SocialProvider } from "@/components/settings/linked-accounts";
import { getSessionFromApi } from "@/lib/auth/session";

import ClientSettings from "./client-settings";

const credentialAccountWhere = (userId: string) => ({
  password: { not: null },
  providerId: "credential",
  userId,
});

function isSocialProvider(providerId: string): providerId is SocialProvider {
  return providerId === "google" || providerId === "reddit";
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<FeedViewSkeleton />}>
      <SettingsContent />
    </Suspense>
  );
}

async function SettingsContent() {
  const session = await getSessionFromApi();

  if (!session?.user) {
    redirect("/login");
  }

  const [user, passwordAccount, socialAccounts] = await Promise.all([
    prisma.user.findUnique({
      select: getPrivateUserSelect(session.user.id),
      where: { id: session.user.id },
    }),
    prisma.account.findFirst({
      select: { id: true },
      where: credentialAccountWhere(session.user.id),
    }),
    prisma.account.findMany({
      select: { providerId: true },
      where: {
        providerId: { in: ["google", "reddit"] },
        userId: session.user.id,
      },
    }),
  ]);

  if (!user) {
    redirect("/login");
  }

  return (
    <ClientSettings
      accountLinkingReadiness={{
        hasPassword: Boolean(passwordAccount),
        hasVerifiedEmail: Boolean(user.email && user.emailVerified),
        linkedProviders: socialAccounts
          .map((account) => account.providerId)
          .filter(isSocialProvider),
      }}
      user={user}
    />
  );
}
