import type { Metadata } from "next";
import { Suspense } from "react";

import { CenteredLogoLoader } from "@/components/layouts/loaders/centered-logo-loader";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

import { ClientGusts } from "./client-gusts";

export const metadata: Metadata = {
  description:
    "Explore high-energy short-form video clips and creative gusts on Asocialmedia.",
  title: "Gusts — Asocialmedia",
};

export default async function Page() {
  const session = await getSessionFromApi();
  const loggedInUserData = session?.user
    ? await getUserData(session.user.id)
    : null;

  return (
    <Suspense fallback={<CenteredLogoLoader size={64} />}>
      <ClientGusts loggedInUserData={loggedInUserData} />
    </Suspense>
  );
}
