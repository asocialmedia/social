import { prisma } from "@asm/db";
import { z } from "zod";
import { authClient } from "@/lib/auth";

const emailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export async function PATCH(request: Request) {
  try {
    const session = await authClient.getSession();
    if (!session?.data?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { user } = session.data;

    const body = await request.json();
    const { email } = emailSchema.parse(body);

    // Check if email is already taken by another user
    const existingUser = await prisma.user.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        id: { not: user.id },
      },
    });

    if (existingUser) {
      return Response.json(
        { error: "Email is already taken" },
        { status: 400 }
      );
    }

    // Update email in database and mark as unverified
    await prisma.user.update({
      where: { id: user.id },
      data: {
        email,
        emailVerified: false,
      },
    });

    // Better Auth will automatically send verification email when email is changed
    // The email change will trigger the verification flow

    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to update email:", error);
    return Response.json({ error: "Failed to update email" }, { status: 500 });
  }
}
