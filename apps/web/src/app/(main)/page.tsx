import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { Suspense } from "react";

import AppShellSkeleton from "@/components/layouts/skeletons/app-shell-skeleton";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

import ClientHome from "./client-home";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
  description:
    "Browse the global feed on asocialmedia — a cozy, open source social platform. See what's trending, explore hashtags, and read the conversation without an account.",
  keywords: [
    "asocialmedia",
    "global feed",
    "trending",
    "social feed",
    "open source social media",
  ],
  openGraph: {
    description:
      "Browse the global feed on asocialmedia — a cozy, open source social platform. See what's trending and join the conversation.",
    siteName: siteConfig.name,
    title: siteConfig.name,
    type: "website",
  },
  // No explicit title: the root layout's default (`%s` template) already
  // brands the home page without doubling it.
};

// The page shell is synchronous so the router can stream it immediately; the
// session and user lookups resolve inside the Suspense boundary and replace
// the skeleton when ready.
export default function Page() {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const session = await getSessionFromApi();

  // Guests can browse the home feed; the client decides which tabs and
  // interactive features are available without an account.
  const userData = session?.user ? await getUserData(session.user.id) : null;

  return <ClientHome userData={userData} />;
}
