import type React from "react";

import { GooeyToaster } from "@/components/auth/gooey-toaster";
import FloatingPostComposer from "@/components/layouts/floating-post-composer";
import { GuestAuthBar } from "@/components/layouts/guest-auth-bar";
import { SpotlightProvider } from "@/components/search/spotlight-provider";
import { getSessionFromApi } from "@/lib/session";

import SessionProvider from "./session-provider";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionFromApi();
  const isLoggedIn = Boolean(session?.user);

  return (
    <SessionProvider value={session}>
      <SpotlightProvider>
        <main
          className="font-sofiaProSoft flex flex-1 flex-col"
          id="main-content"
        >
          {children}
        </main>
      </SpotlightProvider>
      {isLoggedIn ? <FloatingPostComposer /> : <GuestAuthBar />}
      <GooeyToaster />
    </SessionProvider>
  );
}
