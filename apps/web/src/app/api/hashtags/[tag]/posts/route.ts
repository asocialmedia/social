import { normalizeHashtag } from "@asm/protocols/discovery";

import { getSessionFromApi } from "@/lib/auth/session";
import { explicitContentEnabled } from "@/lib/posts/explicit-content-enabled";
import { getHashtagPostPage } from "@/lib/posts/hashtag-posts";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tag: string }> }
) {
  const resolved = await params;
  const tag = normalizeHashtag(resolved.tag);
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  if (!tag || (cursor && !/^[A-Za-z0-9-]{1,128}$/.test(cursor))) {
    return Response.json(
      { error: "Invalid hashtag or cursor" },
      { status: 400 }
    );
  }
  const session = await getSessionFromApi();
  const viewer = session?.user.id ?? "";
  return Response.json(
    await getHashtagPostPage(
      tag,
      viewer,
      await explicitContentEnabled(viewer),
      cursor
    ),
    { headers: { "cache-control": "private, no-store" } }
  );
}
