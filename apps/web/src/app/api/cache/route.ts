import { followerInfoCache } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");

    if (!userId) {
      return Response.json({ error: "Missing userId" }, { status: 400 });
    }

    const data = await followerInfoCache.get(userId);
    return Response.json(data);
  } catch (error) {
    console.error("Cache GET error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
