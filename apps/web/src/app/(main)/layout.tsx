import { redirect } from "next/navigation";
import type React from "react";
import { GooeyToaster } from "@/components/auth/gooey-toaster";
import FloatingPostComposer from "@/components/layouts/floating-post-composer";
import { SpotlightProvider } from "@/components/search/spotlight-provider";
import { getSessionFromApi } from "@/lib/session";
import SessionProvider from "./session-provider";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionFromApi();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <SessionProvider value={session}>
      <SpotlightProvider>
        <div className="flex flex-1 flex-col font-sofiaProSoft">{children}</div>
      </SpotlightProvider>
      <FloatingPostComposer />
      <GooeyToaster />
    </SessionProvider>
  );
}
