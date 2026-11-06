import { FeedReadError, retryAfterMs } from "@asm/protocols/discovery";

// A browser's retained pages can outlive the server's snapshot.
export async function readFeedPage<Page extends { posts: { id: string }[] }>(
  read: (cursor: string | null) => Promise<Response>,
  cursor: string | null,
  known: ReadonlySet<string>
): Promise<Page> {
  let response = await read(cursor);
  let recovered = false;
  if (response.status === 410 && cursor) {
    await response.body?.cancel();
    response = await read(null);
    recovered = true;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new FeedReadError(
      response.status,
      retryAfterMs(response.headers.get("retry-after"))
    );
  }
  const page: Page = await response.json();
  return recovered
    ? { ...page, posts: page.posts.filter((post) => !known.has(post.id)) }
    : page;
}
