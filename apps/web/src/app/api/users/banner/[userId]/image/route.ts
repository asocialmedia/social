import { prisma } from "@asm/db";
import { GetObjectCommand } from "@aws-sdk/client-s3";

import { ASMOB_BUCKET, asmobClient } from "@/lib/media/object-storage";

import { serveBannerImage } from "./handler";

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  const { userId } = await context.params;
  return serveBannerImage(
    request,
    userId,
    async (id) => {
      const user = await prisma.orm.public.Users.select("bannerKey")
        .where({ id })
        .first();
      return user?.bannerKey ?? null;
    },
    (key, signal) =>
      asmobClient.send(
        new GetObjectCommand({ Bucket: ASMOB_BUCKET, Key: key }),
        { abortSignal: signal }
      )
  );
}
