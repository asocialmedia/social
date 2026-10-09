import { and, fromPrismaDateTime, prisma } from "@asm/db";
import { redirect } from "next/navigation";
import { connection } from "next/server";
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
  // Claims the request before the first read. Prisma 8 stamps every query with
  // a crypto.randomUUID() plan id, and Cache Components fails a prerender that
  // touches an uncached value, so an unclaimed database read aborts the
  // prerender. headers() alone does not claim it: partial prefetching serves
  // runtime data during the shell render.
  await connection();

  const session = await getSessionFromApi();

  if (!session?.user) {
    redirect("/login");
  }

  const [user, passwordAccount, socialAccounts, twoFactor, passkeys] =
    await Promise.all([
      getUserData(session.user.id),
      // Canonical credential selector (accountId=userId), matching sign-in.
      // A (providerId, userId)-only match could report a password on a legacy
      // email-keyed row that sign-in never reads.
      prisma.orm.public.Accounts.select("id")
        .where((account) =>
          and(
            account.password.isNotNull(),
            account.providerId.eq("credential"),
            account.accountId.eq(session.user.id),
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
