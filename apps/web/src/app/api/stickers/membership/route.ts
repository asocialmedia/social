import { getSessionFromApi } from "@/lib/auth/session";
import {
  findStickerLibraryEntry,
  resolveStickerSource,
  stickerMessageSchema,
} from "@/lib/media/sticker-library";

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = stickerMessageSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Choose a sticker message" },
      { status: 400 }
    );
  }
  const source = await resolveStickerSource(parsed.data, session.user.id);
  if (!source) {
    return Response.json({ error: "Sticker is unavailable" }, { status: 404 });
  }
  const item = await findStickerLibraryEntry(session.user.id, source);
  return Response.json(
    { item },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
