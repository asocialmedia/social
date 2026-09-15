import { linkCommunityMedia } from "@/lib/communities/link-media";

// Links a READY upload as the community avatar. Owner/moderator only.
export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const result = await linkCommunityMedia(slug, "avatar", request);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ avatar: { key: result.key, url: result.url } });
}
