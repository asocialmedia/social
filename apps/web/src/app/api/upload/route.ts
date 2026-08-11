import { type MediaType, prisma } from "@asm/db";
import { imageSize } from "image-size";
import { NextResponse } from "next/server";
import { uploadToAsmob } from "@/lib/object-storage";
import { getSessionFromApi } from "@/lib/session";

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const postId = formData.get("postId") as string | null;

  if (!file) {
    return new NextResponse("No file provided", { status: 400 });
  }

  console.log("Uploading file:", {
    name: file.name,
    postId,
    size: file.size,
    type: file.type,
  });

  const upload = await uploadToAsmob(file, user.id);

  let width: number | null = null;
  let height: number | null = null;
  if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const dimensions = imageSize(Buffer.from(arrayBuffer));
      width = dimensions.width ?? null;
      height = dimensions.height ?? null;
    } catch (error) {
      console.error("Failed to read image dimensions:", error);
    }
  }

  const media = await prisma.media.create({
    data: {
      key: upload.key,
      mimeType: upload.mimeType,
      postId,
      size: upload.size,
      type: upload.type as MediaType,
      url: upload.url,
      width,
      height,
    },
  });

  return NextResponse.json({
    key: upload.key,
    mediaId: media.id,
    type: media.type,
    url: upload.url,
    width,
    height,
  });
}
