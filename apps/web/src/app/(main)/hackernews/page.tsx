import { Suspense } from "react";
import { CenteredLogoLoader } from "@/components/layouts/loaders/centered-logo-loader";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";
import ClientHackerNews from "./client-hackernews";

export const metadata = {
  title: "HackerNews",
  description: "Explore the latest stories from HackerNews",
};

export default async function HackerNewsPage() {
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
      <ClientHackerNews userData={userData} />
    </Suspense>
  );
}
