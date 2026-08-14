import { Suspense } from "react";

import { CenteredLogoLoader } from "@/components/layouts/loaders/centered-logo-loader";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

import ClientHome from "./client-home";

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
