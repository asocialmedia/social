import { getUserDataSelect, prisma } from "@asm/db";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/session";

export async function GET(
  _request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await context.params;

    if (!userId) {
      return NextResponse.json(
        { message: "User ID is required" },
        { status: 400 }
      );
    }

    // Public projection only: never serialize a raw Prisma user row, which
    // would include email, passwordHash and OAuth provider ids.
    const session = await getSessionFromApi();
    const viewerId = session?.user?.id ?? "";

    const user = await prisma.user.findUnique({
      select: getUserDataSelect(viewerId),
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    return NextResponse.json(
      { message: "Failed to fetch user data" },
      { status: 500 }
    );
  }
}
