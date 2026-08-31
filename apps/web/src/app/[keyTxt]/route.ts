import { getIndexNowKey } from "@/lib/indexnow";

// Serves the IndexNow key file at /{KEY}.txt
// IndexNow verification requires https://asocialmedia.cc/{KEY}.txt to contain exactly the key.
// Example: if INDEXNOW_KEY=abc123, then GET /abc123.txt returns "abc123".
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ keyTxt: string }> }
) {
  const { keyTxt } = await params;
  const key = getIndexNowKey();

  if (!key) {
    return new Response("Not found", { status: 404 });
  }

  // Expected file is exactly "{key}.txt"
  if (keyTxt !== `${key}.txt`) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(key, {
    headers: {
      "cache-control": "public, max-age=86400",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
