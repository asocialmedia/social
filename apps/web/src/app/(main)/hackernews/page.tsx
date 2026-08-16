import { redirect } from "next/navigation";
import { Suspense } from "react";

import AppShellSkeleton from "@/components/layouts/skeletons/app-shell-skeleton";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

import ClientHackerNews from "./client-hackernews";

export const metadata = {
  description: "Explore the latest stories from HackerNews",
  title: "HackerNews",
};

export default function HackerNewsPage() {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <HackerNewsContent />
    </Suspense>
  );
}

async function HackerNewsContent() {
  const session = await getSessionFromApi();

  if (!session?.user) {
    redirect("/login");
  }

  const userData = await getUserData(session.user.id);

  if (!userData) {
    return <p className="text-destructive">Unable to load user data.</p>;
  }

  return <ClientHackerNews userData={userData} />;
}
