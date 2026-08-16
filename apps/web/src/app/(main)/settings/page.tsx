import { getUserDataSelect, prisma } from "@asm/db";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import AppShellSkeleton from "@/components/layouts/skeletons/app-shell-skeleton";
import { getSessionFromApi } from "@/lib/session";

import ClientSettings from "./client-settings";

export default function SettingsPage() {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <SettingsContent />
    </Suspense>
  );
}

async function SettingsContent() {
  const session = await getSessionFromApi();

  if (!session?.user) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    select: getUserDataSelect(session.user.id),
    where: { id: session.user.id },
  });

  if (!user) {
    redirect("/login");
  }

  return <ClientSettings user={user} />;
}
