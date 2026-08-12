import { redirect } from "next/navigation";
import type React from "react";
import { getSessionFromApi } from "@/lib/session";
import SessionProvider from "./session-provider";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionFromApi();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <SessionProvider value={session}>
      <div className="flex flex-1 flex-col font-sofiaProSoft">{children}</div>
    </SessionProvider>
  );
}
