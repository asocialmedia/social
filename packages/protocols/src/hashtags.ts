export function normalizeHashtag(value: string): string | null {
  // NFC unifies composed accents while retaining fullwidth and ASCII distinctions.
  const tag = value
    .replace(/^#/, "")
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFC");
  return tag.length > 0 &&
    tag.length <= 64 &&
    /^[\p{L}\p{M}\p{N}_-]+$/u.test(tag)
    ? tag
    : null;
}

export function hasHashtag(
  post: {
    content?: string;
    text?: string;
    tags?: readonly (string | { name: string })[];
    facets?: { tags: string[] };
  },
  tag: string
): boolean {
  const normalized = normalizeHashtag(tag);
  if (!normalized) {
    return false;
  }
  const declared = [
    ...(post.tags ?? []).map((item) =>
      typeof item === "string" ? item : item.name
    ),
    ...(post.facets?.tags ?? []),
  ];
  if (declared.some((item) => normalizeHashtag(item) === normalized)) {
    return true;
  }
  return [
    ...(post.content ?? post.text ?? "").matchAll(
      /(?:^|[^\p{L}\p{M}\p{N}_])#(?<tag>[\p{L}\p{M}\p{N}_-]+)/gu
    ),
  ].some((match) => normalizeHashtag(match.groups?.tag ?? "") === normalized);
}
