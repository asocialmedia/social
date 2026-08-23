import { buildSitemapXml, getSitemapEntries, isSitemapId } from "@/lib/sitemap";

// Child sitemaps: /sitemaps/{core,posts,users,tags}.xml. The id comes from
// the URL segment here (unlike the old generateSitemaps convention that
// delivered an array index), so each file finally serves its own URL set.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const fileName = id.replace(/\.xml$/, "");

  if (!isSitemapId(fileName)) {
    return new Response("Not found", { status: 404 });
  }

  const entries = await getSitemapEntries(fileName);

  return new Response(buildSitemapXml(entries), {
    headers: {
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      "content-type": "application/xml; charset=utf-8",
    },
  });
}
