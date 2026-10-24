import { externalFeedbackSchema } from "@asm/protocols/discovery";

import { getSessionFromApi } from "@/lib/auth/session";
import { writeExternalFeedback } from "@/lib/protocols/feedback";
import {
  consumeProtocolBudget,
  ProtocolGatewayError,
  protocolJsonBody,
  protocolRoute,
} from "@/lib/protocols/gateway";

function handle(request: Request, remove: boolean) {
  return protocolRoute(request, "feedback", async () => {
    const feedback = externalFeedbackSchema.safeParse(
      await protocolJsonBody(request)
    );
    if (
      !feedback.success ||
      !feedback.data.postId.startsWith(`at://${feedback.data.authorId}/`)
    ) {
      throw new ProtocolGatewayError(400, "invalid_preference");
    }
    const session = await getSessionFromApi();
    if (!session?.user.id) {
      return Response.json(
        { error: "Sign in to sync preferences" },
        { status: 401 }
      );
    }
    await consumeProtocolBudget(session.user.id, "feedback", true);
    await writeExternalFeedback(session.user.id, feedback.data, remove);
    return Response.json({ saved: true });
  });
}
export function POST(request: Request) {
  return handle(request, false);
}
export function DELETE(request: Request) {
  return handle(request, true);
}
