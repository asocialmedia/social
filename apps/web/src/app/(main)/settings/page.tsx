import { getUserDataSelect, prisma } from "@asm/db";
import { redirect } from "next/navigation";
import { getSessionFromApi } from "@/lib/session";
import ClientSettings from "./client-settings";

export default async function SettingsPage() {
  const session = await getSessionFromApi();

  if (!session?.user) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: getUserDataSelect(session.user.id),
  });

  if (!user) {
    redirect("/login");
  }

  return <ClientSettings user={user} />;
}
