import { prisma } from "@asm/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth/config";
import AdminDashboardClient from "./admin-dashboard.client";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const hdrs = await headers();
  const serverHeaders = new Headers();
  const cookie = hdrs.get("cookie");
  const userAgent = hdrs.get("user-agent");
  if (cookie) {
    serverHeaders.set("cookie", cookie);
  }
  if (userAgent) {
    serverHeaders.set("user-agent", userAgent);
  }
  const session = await auth.api.getSession({
    headers: serverHeaders,
  });

  let isAdmin = false;
  if (session?.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });
    isAdmin = user?.role === "admin";
  }

  if (!isAdmin) {
    redirect(process.env.NEXT_PUBLIC_URL || "https://social.localhost");
  }

  return <AdminDashboardClient />;
}
