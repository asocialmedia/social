import { assertChatExportScope, getChatExportStream } from "@asm/db";
import { isUuid } from "@asm/messages";

import { getSessionFromApi } from "@/lib/auth/session";
import { consumeDenRateLimit } from "@/lib/messages/den-rate-limit";
import { lifecycleError } from "@/lib/messages/lifecycle-api";
import { getConversationForUser } from "@/lib/messages/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; exportId: string }> }
) {
  const awaitedChatState0 = await getSessionFromApi();
  const user = awaitedChatState0?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await consumeDenRateLimit(
    {
      bucket: "chat-export-download",
      limit: 10,
      window: "fixed",
      windowSeconds: 3600,
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
    const job = await assertChatExportScope(exportId, user.id, id);
    return new Response(await getChatExportStream(job), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="chat-${exportId}.zip"`,
        "Content-Type": "application/zip",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return lifecycleError(error);
  }
}
