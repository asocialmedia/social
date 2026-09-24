import { and, fromPrismaDateTime, prisma } from "@asm/db";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import type { SecurityPasskey } from "@/app/(main)/settings/tabs/security-settings";
import SettingsPageSkeleton from "@/components/layouts/skeletons/settings-page-skeleton";
import type { SocialProvider } from "@/components/settings/linked-accounts";
import { getUserData } from "@/hooks/users/use-user-data";
import { getSessionFromApi } from "@/lib/auth/session";

import ClientSettings from "./client-settings";

function isSocialProvider(providerId: string): providerId is SocialProvider {
  return providerId === "google" || providerId === "reddit";
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsPageSkeleton />}>
      <SettingsContent />
    </Suspense>
  );
}

async function SettingsContent() {
  const session = await getSessionFromApi();

  if (!session?.user) {
    redirect("/login");
  }

  const [user, passwordAccount, socialAccounts, twoFactor, passkeys] =
    await Promise.all([
      getUserData(session.user.id),
      prisma.orm.public.Accounts.select("id")
        .where((account) =>
          and(
            account.password.isNotNull(),
            account.providerId.eq("credential"),
            account.userId.eq(session.user.id)
          )
        )
        .first(),
      prisma.orm.public.Accounts.select("providerId")
        .where((account) =>
          and(
            account.providerId.in(["google", "reddit"]),
            account.userId.eq(session.user.id)
          )
        )
        .all(),
      prisma.orm.public.TwoFactor.select("verified")
        .where({ userId: session.user.id })
        .first(),
      prisma.orm.public.Passkey.select(
        "aaguid",
        "backedUp",
        "createdAt",
        "deviceType",
        "id",
        "name"
      )
        .where({ userId: session.user.id })
        .orderBy((passkey) => passkey.createdAt.desc())
        .all(),
    ]);

  if (!user) {
    redirect("/login");
  }

  const initialPasskeys = passkeys.map((passkey) => ({
    ...passkey,
    createdAt: fromPrismaDateTime(passkey.createdAt),
  }));

  return (
    <ClientSettings
      accountLinkingReadiness={{
        hasPassword: Boolean(passwordAccount),
        hasVerifiedEmail: Boolean(user.email && user.emailVerified),
        linkedProviders: socialAccounts
          .map((account) => account.providerId)
          .filter(isSocialProvider),
      }}
      currentSessionId={session.session.id}
      initialPasskeys={initialPasskeys satisfies SecurityPasskey[]}
      securityState={{
        hasAuthenticatorApp: Boolean(twoFactor?.verified),
        twoFactorEnabled: user.twoFactorEnabled,
      }}
      user={user}
    />
  );
}
