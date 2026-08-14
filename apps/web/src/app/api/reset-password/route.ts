import { prisma } from "@asm/db";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");

    if (!token || typeof token !== "string" || token.length === 0) {
      return Response.json(
        { error: "Invalid token" },
        {
          headers: { "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const resetToken = await prisma.passwordResetToken.findUnique({
      include: { user: true },
      where: { token },
    });

    if (!resetToken) {
      return Response.json(
        { error: "Token not found" },
        {
          headers: { "Content-Type": "application/json" },
          status: 404,
        }
      );
    }

    if (resetToken.expiresAt < new Date()) {
      await prisma.passwordResetToken.delete({
        where: { id: resetToken.id },
      });

      return Response.json(
        { error: "Token expired" },
        {
          headers: { "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    return Response.json(
      { valid: true },
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Reset token verification error:", error);
    return Response.json(
      { error: "Invalid token" },
      {
        headers: { "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
}
