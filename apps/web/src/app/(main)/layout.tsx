import { connection } from "next/server";
import type React from "react";
import { Suspense } from "react";

import { GooeyToaster } from "@/components/auth/shell/gooey-toaster";
import FloatingPostComposer from "@/components/layouts/feed/floating-post-composer";
import { GuestAuthBar } from "@/components/layouts/shell/guest-auth-bar";
import { MainShell } from "@/components/layouts/shell/main-shell";
import AppShellSkeleton from "@/components/layouts/skeletons/app-shell-skeleton";
import { SpotlightProvider } from "@/components/search/spotlight-provider";
import { getUserData } from "@/hooks/users/use-user-data";
import { getSessionFromApi } from "@/lib/auth/session";

import SessionProvider from "./session-provider";
import SessionRevocationGuard from "./session-revocation-guard";

// The session lookup reads request-bound data (await connection()), so it must
// live inside a Suspense boundary for the segment to keep a streaming static
// shell. Keep this layout synchronous and stream the auth-gated chrome below.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main
        className="font-sofiaProSoft flex flex-1 flex-col"
        id="main-content"
      >
        <Suspense fallback={<AppShellSkeleton />}>
          <AuthenticatedShell>{children}</AuthenticatedShell>
        </Suspense>
      </main>
      <GooeyToaster />
    </>
  );
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  // Claims the request before the first read. Prisma 8 stamps every query with
  // a crypto.randomUUID() plan id, and Cache Components fails a prerender that
  // touches an uncached value, so an unclaimed database read aborts the
  // prerender. headers() alone does not claim it: partial prefetching serves
  // runtime data during the shell render.
  await connection();

  const session = await getSessionFromApi();
  const isLoggedIn = Boolean(session?.user);
  const currentSessionId = session?.session.id;
  // Resolve the user once here and share it with the persistent left nav so
  // the nav doesn't re-fetch on every route change. Pages receive their own
  // full userData from their data layer, unrelated to this cached lookup.
  const userData = session?.user ? await getUserData(session.user.id) : null;

  return (
    <SessionProvider value={session}>
      {currentSessionId ? (
        <SessionRevocationGuard currentSessionId={currentSessionId} />
      ) : null}
      <SpotlightProvider>
        {/* Persistent app chrome. The left nav and the full-height shell live
            here (not inside each page), so App Router keeps them mounted across
            route changes instead of collapsing them into the loading skeleton on
            every navigation. Pages render only their center column + right rail
            inside the flex-1 region. MobileBottomNav stays per-page: some
            immersive routes (post, gust, profile) intentionally omit it. Media
            routes are standalone fullscreen pages, so MainShell skips the chrome
            there entirely. */}
        <MainShell userData={userData}>{children}</MainShell>
        {isLoggedIn ? <FloatingPostComposer /> : <GuestAuthBar />}
      </SpotlightProvider>
    </SessionProvider>
  );
}
