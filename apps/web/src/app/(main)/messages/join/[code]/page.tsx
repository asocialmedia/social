import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";
import { MessagesSkeleton } from "@/components/messages/messages-skeleton";
import { getUserData } from "@/hooks/users/use-user-data";
import { getSessionFromApi } from "@/lib/auth/session";

import ClientJoinDen from "./client-join-den";

export const metadata: Metadata = {
  // A join link is a private door, not a page anybody searches for: it names one
  // den to people who already hold the code, and the name is only known once the
  // preview resolves. So there is nothing to index here.
  robots: { follow: false, index: false },
  title: "Join den",
};

interface PageProps {
  params: Promise<{ code: string }>;
}

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<MessagesSkeleton />}>
      <JoinDenContent params={props.params} />
    </Suspense>
  );
}

async function JoinDenContent({ params }: PageProps) {
  // Claims the request before the first read, the same reason the messages page
  // does: an unclaimed database read aborts the prerender.
  await connection();

  const session = await getSessionFromApi();
  const userData = session?.user ? await getUserData(session.user.id) : null;
  if (!userData) {
    redirect("/login");
  }

  const { code } = await params;
  // No identity provider here on purpose. Joining writes no key of its own: the
  // first send mints the root-key epoch, and that send happens in the thread this
  // navigates to, which has its own provider. Wrapping this screen in one would
  // only add a key derivation the screen never reads.
  return (
    <>
      <ClientJoinDen code={code} />
      <MobileBottomNav />
    </>
  );
}
