import { getCommunityPreview } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const session = await getSessionFromApi();
  const preview = await getCommunityPreview(slug, session?.user?.id ?? "");
  return Response.json(preview ?? { error: "Community not found" }, {
    headers: { "cache-control": "private, no-store", vary: "Cookie" },
    status: preview ? 200 : 404,
  });
}
