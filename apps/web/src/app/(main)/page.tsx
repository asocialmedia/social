import { Suspense } from "react";
import { CenteredLogoLoader } from "@/components/layouts/loaders/centered-logo-loader";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";
import ClientHome from "./client-home";

export default async function Page() {
  const session = await getSessionFromApi();

  if (!session?.user) {
    return (
      <p className="text-destructive">
        You&apos;re not authorized to view this page.
      </p>
    );
  }

  const userData = await getUserData(session.user.id);

  if (!userData) {
    return <p className="text-destructive">Unable to load user data.</p>;
  }

  return (
    <Suspense fallback={<CenteredLogoLoader size={64} />}>
      <ClientHome userData={userData} />
    </Suspense>
  );
}
