import { redirect } from "next/navigation";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type React from "react";

import { GooeyToaster } from "@/components/auth/gooey-toaster";
import { getSessionFromApi } from "@/lib/session";

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
