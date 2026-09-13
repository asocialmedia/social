import type { JSONContent } from "@tiptap/core";

// Converts a stored plain-text string into rich editor content. Inline pills
// are collapsed to `@user` / `#tag` (and links to their URL) on save, so a
// reload or a tab remount re-parses those tokens back into pills. Without
// this the mention/tag/URL chip would visually revert to plain text after the
// editor instance is recreated.
//
// Kept free of any TipTap runtime import so it can be unit-tested without a
// DOM (importing the node definitions pulls in prosemirror-view, which touches
// `document` at module load).

const INLINE_TOKEN_RE =
  /(?<mention>@[a-zA-Z0-9_-]+)|(?<hashtag>#[a-zA-Z0-9_-]+)|(?<url>https?:\/\/[^\s<>"']+)/g;

function lineToContent(line: string, enableLinks: boolean): JSONContent[] {
  const content: JSONContent[] = [];
  let cursor = 0;
  for (const match of line.matchAll(INLINE_TOKEN_RE)) {
    const index = match.index ?? -1;
    if (index < 0) {
      continue;
    }
    if (index > cursor) {
      content.push({ text: line.slice(cursor, index), type: "text" });
    }
    const groups = match.groups ?? {};
    if (groups.mention) {
      // Only the username survives plain-text storage; id/avatar are unknown
      // until the user picks again, so the pill renders the initial fallback.
      const username = groups.mention.slice(1);
      content.push({
        attrs: { avatarUrl: "", displayName: username, id: "", username },
        type: "mention",
      });
    } else if (groups.hashtag) {
      content.push({
        attrs: { tag: groups.hashtag.slice(1) },
        type: "hashtag",
      });
    } else if (groups.url) {
      const { url } = groups;
      content.push(
        enableLinks
          ? {
              marks: [{ attrs: { href: url }, type: "link" }],
              text: url,
              type: "text",
            }
          : { text: url, type: "text" }
      );
    }
    cursor = index + match[0].length;
  }
  if (cursor < line.length) {
    content.push({ text: line.slice(cursor), type: "text" });
  }
  return content;
}

export function textToDoc(text: string, enableLinks: boolean): JSONContent {
  const lines = text.split("\n");
  return {
    content: lines.map((line) => {
      const content = lineToContent(line, enableLinks);
      return {
        content: content.length > 0 ? content : undefined,
        type: "paragraph",
      };
    }),
    type: "doc",
  };
}
