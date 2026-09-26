import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import HackerNewsPageSkeleton from "@/components/layouts/skeletons/hackernews-page-skeleton";
import { getUserData } from "@/hooks/users/use-user-data";
import { getSessionFromApi } from "@/lib/auth/session";

import ClientHackerNews from "./client-hackernews";

export const metadata = {
  description: "Explore the latest stories from HackerNews",
  title: "HackerNews",
};

export default function HackerNewsPage() {
  return (
    <Suspense fallback={<HackerNewsPageSkeleton />}>
      <HackerNewsContent />
    </Suspense>
  );
}

async function HackerNewsContent() {
  // Claims the request before the first read. Prisma 8 stamps every query with
  // a crypto.randomUUID() plan id, and Cache Components fails a prerender that
  // touches an uncached value, so an unclaimed database read aborts the
  // prerender. headers() alone does not claim it: partial prefetching serves
  // runtime data during the shell render.
  await connection();

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
