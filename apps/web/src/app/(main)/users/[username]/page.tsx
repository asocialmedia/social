import { getUserDataSelect, prisma } from "@asm/db";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

import ClientProfile from "./client-profile";

interface PageProps {
  params: Promise<{ username: string }>;
}

const getUser = cache(async (username: string, loggedInUserId: string) => {
  const user = await prisma.user.findFirst({
    select: getUserDataSelect(loggedInUserId),
    where: {
      username: {
        equals: username,
        mode: "insensitive",
      },
    },
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

  const [userData, loggedInUserData] = await Promise.all([
    getUser(username, session?.user?.id ?? ""),
    session?.user ? getUserData(session.user.id) : Promise.resolve(null),
  ]);

  if (session?.user && !loggedInUserData) {
    notFound();
  }

  return (
    <ClientProfile loggedInUserData={loggedInUserData} userData={userData} />
  );
}
