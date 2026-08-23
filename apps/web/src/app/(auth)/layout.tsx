import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type React from "react";

import { GooeyToaster } from "@/components/auth/gooey-toaster";
import { getSessionFromApi } from "@/lib/session";

// Auth pages (login, signup, reset, verify) are not indexable content. The
// only pages Google ever managed to crawl were these three; an explicit
// noindex accelerates their removal and keeps crawl budget on real content.
export const metadata: Metadata = {
  robots: {
    follow: true,
    index: false,
  },
};

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionFromApi();

  if (session?.user) {
    redirect("/");
  }

  return (
    <div className="font-sofiaProSoftMed">
      <NuqsAdapter>{children}</NuqsAdapter>
      <GooeyToaster />
    </div>
  );
}
