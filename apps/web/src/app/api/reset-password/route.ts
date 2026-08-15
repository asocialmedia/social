import { prisma } from "@asm/db";
import type { NextRequest } from "next/server";

// Better-auth stores password reset tokens in the verification table under a
// `reset-password:{token}` identifier. Validate the token against that row so
// the confirm form accepts links issued by the auth service's
// /request-password-reset flow (the legacy PasswordResetToken model is unused
// and would reject every valid link).
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

    const resetToken = await prisma.verification.findFirst({
      where: { identifier: `reset-password:${token}` },
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
      await prisma.verification.delete({
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
