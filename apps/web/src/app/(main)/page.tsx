import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { Suspense } from "react";

import { CenteredLogoLoader } from "@/components/layouts/loaders/centered-logo-loader";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

import ClientHome from "./client-home";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
  description:
    "Browse the global feed on Asocialmedia — a cozy, open source social platform. See what's trending, explore hashtags, and read the conversation without an account.",
  keywords: [
    "asocialmedia",
    "global feed",
    "trending",
    "social feed",
    "open source social media",
  ],
  openGraph: {
    description:
      "Browse the global feed on Asocialmedia — a cozy, open source social platform. See what's trending and join the conversation.",
    siteName: siteConfig.name,
    title: siteConfig.name,
    type: "website",
  },
  // No explicit title: the root layout's default (`%s` template) already
  // brands the home page without doubling it.
};

export default async function Page() {
  const session = await getSessionFromApi();

  // Guests can browse the home feed; the client decides which tabs and
  // interactive features are available without an account.
  const userData = session?.user ? await getUserData(session.user.id) : null;

  return (
    <Suspense fallback={<CenteredLogoLoader size={64} />}>
      <ClientHome userData={userData} />
    </Suspense>
  );
}
