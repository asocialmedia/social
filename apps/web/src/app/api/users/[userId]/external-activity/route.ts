import { getSessionFromApi } from "@/lib/auth/session";
import {
  profileActivityCursorSchema,
  profileExternalActivity,
} from "@/lib/protocols/profile-activity";

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  const session = await getSessionFromApi();
  if (!session?.user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind");
  if (kind !== "amplified" && kind !== "eddies") {
    return Response.json({ error: "Invalid activity kind" }, { status: 400 });
  }
  const rawCursor = query.get("cursor");
  let cursor;
  if (rawCursor) {
    try {
      if (rawCursor.length > 512) {
        throw new Error("Invalid cursor");
      }
      cursor = profileActivityCursorSchema.parse(JSON.parse(rawCursor));
    } catch {
      return Response.json({ error: "Invalid cursor" }, { status: 400 });
    }
  }
  const { userId } = await context.params;
  const page = await profileExternalActivity(
    userId,
    session.user.id,
    kind,
    request.signal,
    cursor
  );
  return Response.json(page, {
    headers: { "cache-control": "private, no-store", vary: "Cookie" },
  });
}
