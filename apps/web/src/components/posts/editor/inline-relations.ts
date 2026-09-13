import type { JSONContent } from "@tiptap/core";

// Pure relation helpers for the composer's inline mention/hashtag pills.
// Kept free of any TipTap runtime import so they can be unit-tested without
// a DOM/editor environment (importing the node definitions pulls in
// prosemirror-view, which touches `document` at module load).

export interface InlineRelations {
  mentionIds: string[];
  tags: string[];
}

// Walks a TipTap JSON doc and collects the relations carried by inline
// pills: mention node ids (authoritative, no username lookup needed) and
// hashtag node tags. Plain `@text` / `#text` without a pill intentionally
// contributes nothing - only an explicit autocomplete pick notifies or
// creates a relation, so typos never farm mentions or spawn tags.
export function collectInlineRelations(doc: unknown): InlineRelations {
  const mentionIds: string[] = [];
  const tags: string[] = [];
  const seenMentions = new Set<string>();
  const seenTags = new Set<string>();

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }
    const record = node as Record<string, unknown>;
    if (record.type === "mention") {
      const attrs = (
        record.attrs && typeof record.attrs === "object" ? record.attrs : {}
      ) as Record<string, unknown>;
      const { id } = attrs;
      if (typeof id === "string" && id.length > 0 && !seenMentions.has(id)) {
        seenMentions.add(id);
        mentionIds.push(id);
      }
    } else if (record.type === "hashtag") {
      const attrs = (
        record.attrs && typeof record.attrs === "object" ? record.attrs : {}
      ) as Record<string, unknown>;
      const { tag } = attrs;
      if (typeof tag === "string" && tag.length > 0) {
        const normalized = tag.toLowerCase();
        if (!seenTags.has(normalized)) {
          seenTags.add(normalized);
          tags.push(normalized);
        }
      }
    }
    const { content } = node as JSONContent;
    if (Array.isArray(content)) {
      for (const child of content) {
        visit(child);
      }
    }
  };

  visit(doc);
  return { mentionIds, tags };
}

// Merges explicitly added ids (composer chips, gust pickers) with the ids
// carried by inline pills, preserving first-seen order.
export function mergeUniqueIds(explicit: string[], inline: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of [...explicit, ...inline]) {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(id);
  }
  return merged;
}
