import type { Metadata } from "next";
import { Suspense } from "react";

import { GustCardSkeleton } from "@/components/gusts/gust-card-skeleton";
import { getUserData } from "@/hooks/use-user-data";
import { absoluteUrl, siteConfig } from "@/lib/seo";
import { getSessionFromApi } from "@/lib/session";

import { ClientGusts } from "./client-gusts";

export const metadata: Metadata = {
  alternates: { canonical: "/gusts" },
  description:
    "Explore high-energy short-form video clips and creative gusts on Asocialmedia.",
  keywords: [
    "gusts",
    "short-form video",
    "reels",
    "video clips",
    "Asocialmedia",
  ].join(", "),
  openGraph: {
    description:
      "Explore high-energy short-form video clips and creative gusts on Asocialmedia.",
    images: [absoluteUrl(siteConfig.ogImage)],
    locale: siteConfig.locale,
    siteName: siteConfig.name,
    title: "Gusts — Asocialmedia",
    type: "website",
    url: absoluteUrl("/gusts"),
  },
  title: "Gusts — Asocialmedia",
  twitter: {
    card: "summary_large_image",
    description:
      "Explore high-energy short-form video clips and creative gusts on Asocialmedia.",
    images: [absoluteUrl(siteConfig.ogImage)],
    title: "Gusts — Asocialmedia",
  },
};

export default async function Page() {
  const session = await getSessionFromApi();
  const loggedInUserData = session?.user
    ? await getUserData(session.user.id)
    : null;

  return (
    <Suspense
      fallback={
        <div className="bg-background flex h-dvh w-full items-center justify-center">
          <GustCardSkeleton />
        </div>
      }
    >
      <ClientGusts loggedInUserData={loggedInUserData} />
    </Suspense>
  );
}
