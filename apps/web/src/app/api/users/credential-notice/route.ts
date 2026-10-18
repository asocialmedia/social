import { z } from "zod";

import {
  accountNotices,
  noticeTimestamp,
  queueNotice,
} from "@/lib/auth/account-notices";
import { getSessionFromApi } from "@/lib/auth/session";

const bodySchema = z.discriminatedUnion("kind", [
  z
    .object({
      action: z.enum(["added", "removed"]),
      kind: z.literal("passkey"),
      passkeyName: z.string().trim().min(1).max(120),
    })
    .strict(),
  z
    .object({
      codeCount: z.number().int().positive(),
      kind: z.literal("backup-codes"),
    })
    .strict(),
]);

// Credential changes (passkeys, backup codes) are performed by better-auth
// directly from the browser, so the settings UI reports them here after
// success. Advisory only: this always answers 200 once the input is valid,
// because the credential change has already happened.
export async function POST(request: Request): Promise<Response> {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(
    await request.json().catch(() => /* empty */ null)
  );
  if (!parsed.success) {
    return Response.json({ error: "Invalid notification" }, { status: 400 });
  }

  const recipient = session.user.email;
  if (!recipient || !session.user.emailVerified) {
    return Response.json({ queued: false });
  }

  const payload = parsed.data;
  if (payload.kind === "passkey") {
    const { action, passkeyName } = payload;
    queueNotice(() =>
      accountNotices.passkeyChanged({
        action,
        changedAt: noticeTimestamp(),
        passkeyName,
        recipient,
      })
    );
  } else {
    const { codeCount } = payload;
    queueNotice(() =>
      accountNotices.backupCodesRegenerated({
        changedAt: noticeTimestamp(),
        codeCount,
        recipient,
      })
    );
  }

  return Response.json({ queued: true });
}
