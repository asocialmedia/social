import { getUserDataSelect, prisma } from "@asm/db";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getSessionFromApi } from "@/lib/session";
import ClientProfile from "./client-profile";

interface PageProps {
  params: Promise<{ username: string }>;
}

const getUser = cache(async (username: string, loggedInUserId: string) => {
  const user = await prisma.user.findFirst({
    where: {
      username: {
        equals: username,
        mode: "insensitive",
      },
    },
    select: getUserDataSelect(loggedInUserId),
  });

  if (!user) {
    notFound();
  }

  return user;
});

export default async function Page(props: PageProps) {
  const params = await props.params;
  const { username } = params;
  const session = await getSessionFromApi();

  if (!session?.user) {
    redirect(`/login?next=/users/${encodeURIComponent(username)}`);
  }

  const userData = await getUser(username, session.user.id);

  return (
    <ClientProfile
      loggedInUserId={session.user.id}
      userData={userData}
      username={username}
    />
  );
}
