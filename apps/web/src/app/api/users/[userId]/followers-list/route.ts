import { getSessionFromApi } from "@/lib/auth/session";
import { getProfileUserList } from "@/lib/users/profile-user-list";

export async function GET(
  _request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await getSessionFromApi();
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { userId } = await context.params;
    return Response.json(
      await getProfileUserList(userId, session.user.id, "followers")
    );
  } catch (error) {
    console.error("Error fetching followers list:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
