// Inline @mention / #hashtag tokens shared by the published-post renderer
// and the meta-chip filter. Kept dependency-free so feed cards can use it
// without pulling in the editor or the link-preview stack.

export const INLINE_TOKEN_PATTERN =
  /(?<token>@[a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+)/g;

// Usernames (lowercased, no `@`) and tags (lowercased, no `#`) that appear
// inline in the content. Feed cards use this to hide duplicate meta chips:
// the inline render is the source of truth, and chips remain for relations
// the author added explicitly through the edit dialogs.
export function extractInlineMeta(content: string): {
  tags: Set<string>;
  usernames: Set<string>;
} {
  const tags = new Set<string>();
  const usernames = new Set<string>();
  for (const match of content.matchAll(INLINE_TOKEN_PATTERN)) {
    const [token] = match;
    if (token.startsWith("@")) {
      usernames.add(token.slice(1).toLowerCase());
    } else {
      tags.add(token.slice(1).toLowerCase());
    }
  }
  return { tags, usernames };
}
