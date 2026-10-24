import { prisma } from "@asm/db";

import {
  accountNotices,
  noticeTimestamp,
  queueNotice,
} from "@/lib/auth/account-notices";
import { getSessionFromApi } from "@/lib/auth/session";

export async function POST() {
  const session = await getSessionFromApi();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read the handle before deleting so the notice can name what was detached.
  const linked = await prisma.orm.public.Accounts.select("accountId")
    .where({ providerId: "bluesky", userId: session.user.id })
    .first();

  await prisma.orm.public.Accounts.where({
    providerId: "bluesky",
    userId: session.user.id,
  }).deleteAndCount();

  const recipient = session.user.email;
  if (recipient && session.user.emailVerified) {
    queueNotice(() =>
      accountNotices.socialAccount({
        accountName: linked?.accountId ? `@${linked.accountId}` : "Bluesky",
        action: "unlinked",
        changedAt: noticeTimestamp(),
        provider: "bluesky",
        recipient,
      })
    );
  }

  return Response.json({ ok: true });
}
