import { Prisma, prisma } from "@asm/db";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/session";

const usernameSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores"
    ),
});

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ username: session.user.email });
}

export async function PATCH(request: Request) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = usernameSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid username" },
        { status: 400 }
      );
    }
    const { username } = parsed.data;

    // Pre-check (case-insensitive) so the common collision returns a clean
    // 400 without hitting the database unique constraint.
    const existingUser = await prisma.user.findFirst({
      select: { id: true },
      where: {
        username: { equals: username, mode: "insensitive" },
      },
    });

    if (existingUser && existingUser.id !== user.id) {
      return Response.json(
        { error: "Username is already taken" },
        { status: 400 }
      );
    }

    // Update username. If the case-insensitive unique index catches a
    // concurrent rename, surface the same 400 instead of a 500.
    await prisma.user.update({
      data: { username },
      where: { id: user.id },
    });

    return Response.json({ success: true });
  } catch (error) {
    if (isUniqueConflict(error)) {
      return Response.json(
        { error: "Username is already taken" },
        { status: 400 }
      );
    }
    console.error("Failed to update username:", error);
    return Response.json(
      { error: "Failed to update username" },
      { status: 500 }
    );
  }
}
