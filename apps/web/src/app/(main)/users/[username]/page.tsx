import { getUserDataSelect, prisma } from "@asm/db";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getUserData } from "@/hooks/use-user-data";
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

  const [userData, loggedInUserData] = await Promise.all([
    getUser(username, session.user.id),
    getUserData(session.user.id),
  ]);

  if (!loggedInUserData) {
    redirect(`/login?next=/users/${encodeURIComponent(username)}`);
  }

  return (
    <ClientProfile loggedInUserData={loggedInUserData} userData={userData} />
  );
}
