import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import { MessagesSkeleton } from "@/components/messages/messages-skeleton";
import { MessageIdentityProvider } from "@/components/messages/message-identity-provider";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

import ClientMessages from "./client-messages";

export const metadata: Metadata = {
  title: "Messages",
};

export default function Page() {
  return (
    <Suspense fallback={<MessagesSkeleton />}>
      <MessagesContent />
    </Suspense>
  );
}

async function MessagesContent() {
  const session = await getSessionFromApi();
  const userData = session?.user ? await getUserData(session.user.id) : null;

  if (!userData) {
    redirect("/login");
  }

  return (
    <>
      <MessageIdentityProvider>
        <ClientMessages />
      </MessageIdentityProvider>

      <MobileBottomNav />
    </>
  );
}
