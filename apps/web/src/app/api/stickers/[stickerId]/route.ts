import { prisma, scheduleMediaCleanup } from "@asm/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";

const patchSchema = z
  .object({
    favorite: z.boolean().optional(),
    name: z.string().trim().max(128).optional(),
  })
  .refine((value) => value.favorite !== undefined || value.name !== undefined);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ stickerId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success || [...(parsed.data?.name ?? "")].length > 64) {
    return NextResponse.json(
      { error: "Sticker details are invalid" },
      { status: 400 }
    );
  }
  const { stickerId } = await context.params;
  const entry = await prisma.orm.public.UserStickers.where({
    id: stickerId,
    userId: user.id,
  }).first();
  if (!entry) {
    return NextResponse.json({ error: "Sticker not found" }, { status: 404 });
  }
  await prisma.orm.public.UserStickers.where({
    id: stickerId,
    userId: user.id,
  }).update({
    ...(parsed.data.favorite === undefined
      ? {}
      : { favorite: parsed.data.favorite }),
    ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ stickerId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { stickerId } = await context.params;
  const entry = await prisma.orm.public.UserStickers.select("id", "mediaId")
    .where({ id: stickerId, userId: user.id })
    .first();
  if (!entry) {
    return NextResponse.json({ error: "Sticker not found" }, { status: 404 });
  }
  await prisma.orm.public.UserStickers.where({
    id: stickerId,
    userId: user.id,
  }).delete();
  try {
    await scheduleMediaCleanup(entry.mediaId);
  } catch {
    // The upload's existing cleanup job remains as a retry path if queue storage is unavailable.
  }
  return NextResponse.json({ ok: true });
}
