import type { Metadata } from "next";
import { redirect } from "next/navigation";

import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import { MessageIdentityProvider } from "@/components/messages/message-identity-provider";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

import ClientMessages from "./client-messages";

export const metadata: Metadata = {
  title: "Messages",
};

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSessionFromApi();
  const userData = session?.user ? await getUserData(session.user.id) : null;

  if (!userData) {
    redirect("/login");
  }

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <MessageIdentityProvider>
        <ClientMessages />
      </MessageIdentityProvider>

      <MobileBottomNav />
    </div>
  );
}
