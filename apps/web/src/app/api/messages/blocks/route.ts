import { prisma } from "@asm/db";

import { parseJsonBody } from "@/lib/messages/server";
import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

// Hard cap so an unbounded block list can never balloon a response.
const BLOCK_LIST_LIMIT = 100;

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const blocks = await prisma.block.findMany({
    include: {
      blocked: {
        select: {
          avatarUrl: true,
          displayName: true,
          id: true,
          username: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: BLOCK_LIST_LIMIT,
    where: { blockerId: user.id },
  });

  return Response.json({
    blockedUsers: blocks.map((block) => block.blocked),
  });
}

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(request);
  const body = parsed as { userId?: string } | null;
  const blockedId = body?.userId;
  if (typeof blockedId !== "string" || blockedId.length === 0) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }
  if (blockedId === user.id) {
    return Response.json({ error: "Cannot block yourself" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    select: { id: true },
    where: { id: blockedId },
  });
  if (!target) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  await prisma.block.upsert({
    create: { blockedId, blockerId: user.id },
    update: {},
    where: { blockerId_blockedId: { blockedId, blockerId: user.id } },
  });

  return Response.json({ ok: true }, { status: 201 });
}
