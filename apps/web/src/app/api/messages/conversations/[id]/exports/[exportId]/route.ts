import { assertChatExportScope, chatExportStatus, prisma } from "@asm/db";
import { isUuid } from "@asm/messages";

import { getSessionFromApi } from "@/lib/auth/session";
import { consumeDenRateLimit } from "@/lib/messages/den-rate-limit";
import { lifecycleError } from "@/lib/messages/lifecycle-api";
import { getConversationForUser } from "@/lib/messages/server";

interface Context {
  params: Promise<{ id: string; exportId: string }>;
}
export async function GET(_request: Request, context: Context) {
  const awaitedChatState0 = await getSessionFromApi();
  const user = awaitedChatState0?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await consumeDenRateLimit(
    {
      bucket: "chat-export-status",
      limit: 60,
      window: "fixed",
      windowSeconds: 60,
    },
    user.id
  );
  if (limited) {
    return limited;
  }
  const { id, exportId } = await context.params;
  if (!isUuid(exportId)) {
    return Response.json({ error: "Invalid export" }, { status: 400 });
  }
  try {
    if (!(await getConversationForUser(id, user.id))) {
      return Response.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }
    return Response.json(
      chatExportStatus(await assertChatExportScope(exportId, user.id, id)),
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return lifecycleError(error);
  }
}
export async function DELETE(_request: Request, context: Context) {
  const awaitedChatState1 = await getSessionFromApi();
  const user = awaitedChatState1?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, exportId } = await context.params;
  if (!isUuid(exportId)) {
    return Response.json({ error: "Invalid export" }, { status: 400 });
  }
  try {
    await prisma.orm.public.MessageExportJobs.where({
      conversationId: id,
      id: exportId,
      userId: user.id,
    }).updateAndCount({ status: "cancelled" });
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return lifecycleError(error);
  }
}
