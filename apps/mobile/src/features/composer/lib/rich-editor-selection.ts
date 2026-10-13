import type { InlineEditorDocument } from "@asm/ui/lib/inline-editor-doc";

function inlineText(node: InlineEditorDocument): string {
  if (node.type === "mention") {
    return `@${String(node.attrs?.username ?? "")}`;
  }
  if (node.type === "hashtag") {
    return `#${String(node.attrs?.tag ?? "")}`;
  }
  return node.type === "hardBreak" ? "\n" : (node.text ?? "");
}

// An inline badge occupies one editor position but several plain-text characters.
export function editorPositionForTextOffset(
  doc: InlineEditorDocument,
  offset: number
): number {
  let remaining = Math.max(0, offset);
  let position = 1;
  for (const paragraph of doc.content ?? []) {
    for (const node of paragraph.content ?? []) {
      const text = inlineText(node);
      const size = node.type === "text" ? text.length : 1;
      if (remaining <= text.length) {
        return (
          position + (node.type === "text" ? remaining : Number(remaining > 0))
        );
      }
      remaining -= text.length;
      position += size;
    }
    if (remaining === 0) {
      return position;
    }
    remaining -= 1;
    position += 2;
  }
  return Math.max(1, position - 2);
}

export function textOffsetForEditorPosition(
  doc: InlineEditorDocument,
  target: number
): number {
  let offset = 0;
  let position = 1;
  for (const paragraph of doc.content ?? []) {
    if (target <= position) {
      return offset;
    }
    for (const node of paragraph.content ?? []) {
      const text = inlineText(node);
      const size = node.type === "text" ? text.length : 1;
      if (target < position + size) {
        return (
          offset + (node.type === "text" ? Math.max(0, target - position) : 0)
        );
      }
      offset += text.length;
      position += size;
    }
    if (target <= position) {
      return offset;
    }
    offset += 1;
    position += 2;
  }
  return Math.max(0, offset - 1);
}
