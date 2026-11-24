import { avatarCache, prisma } from "@asm/db";
import { GetObjectCommand } from "@aws-sdk/client-s3";

import { ASMOB_BUCKET, asmobClient } from "@/lib/media/object-storage";

import { serveAvatarImage } from "./handler";

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  const { userId } = await context.params;
  return serveAvatarImage(
    request,
    userId,
    async (id) => {
      const user = await prisma.orm.public.Users.select("avatarKey")
        .where({ id })
        .first();
      return user?.avatarKey ?? null;
    },
    (key, signal) =>
      asmobClient.send(
        new GetObjectCommand({ Bucket: ASMOB_BUCKET, Key: key }),
        { abortSignal: signal }
      ),
    async (id) => {
      const cached = await avatarCache.get(id);
      return cached?.key ?? null;
    }
  );
}
