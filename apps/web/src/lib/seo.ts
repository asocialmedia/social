import type { PostData } from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";

export { siteConfig } from "@asm/ui/meta/site";

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  return new URL(
    path.startsWith("/") ? path : `/${path}`,
    siteConfig.url
  ).toString();
}

// Makes a stored media/avatar URL absolute. Object-storage URLs are already
// absolute; defaults (e.g. "/avatars/default-1.png") are relative.
export function toAbsoluteUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  return absoluteUrl(url);
}

// Normalizes post content into clean, meta-tag-safe text:
// - collapses line breaks and repeated whitespace into single spaces
// - trims markdown formatting characters that Tiptap plain text can retain
// - keeps mentions (@user) and hashtags (#tag), which are useful keywords
export function normalizeText(content: string): string {
  return content
    .replaceAll(/```[\s\S]*?```/g, " ") // code fences
    .replaceAll(/`(?<code>[^`]*)`/g, "$<code>") // inline code
    .replaceAll(/[*_~>#]/g, " ") // md formatting characters
    .replaceAll(/\s+/g, " ")
    .trim();
}

// Truncates text to a maximum length on a word boundary, appending an
// ellipsis when truncated.
export function excerpt(content: string, maxLength = 160): string {
  const normalized = normalizeText(content);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const cut = normalized.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.replace(/[,;:\s]+$/, "")}…`;
}

// SEO title for a post, Reddit-style: author + opening snippet.
export function postTitle(post: PostData, maxLength = 60): string {
  const snippet = excerpt(post.content, maxLength);
  return `${post.user.displayName} (@${post.user.username}): ${snippet}`;
}

// SEO description for a post: the content excerpt plus the tags as keywords.
export function postDescription(post: PostData): string {
  const content = post.content?.trim();
  const base =
    content && content.length >= 20
      ? content
      : `${content || "Eddie"} on Asocialmedia by ${post.user.displayName || post.user.username} (@${post.user.username})`;
  const contentExcerpt = excerpt(base, 140);
  const tags = post.tags.map((tag) => `#${tag.name}`).join(" ");
  return [contentExcerpt, tags].filter(Boolean).join(" · ");
}

// Media objects live in private object storage and are streamed through the
// app's /api/media proxy, so image URLs in metadata must point at the proxy
// path rather than the stored bucket URL. Videos are previewable too: the
// uploader stores a 2s thumbnail frame that is served via ?thumb=1.
function toMediaProxyUrl(media: {
  id: string;
  type: string;
  thumbnailKey?: string | null;
}): string {
  const thumbnail =
    media.type === "VIDEO" && media.thumbnailKey ? "?thumb=1" : "";
  return `/api/media/${media.id}${thumbnail}`;
}

// Images always work for crawlers; videos work when a thumbnail was stored.
function isPreviewable(media: {
  type: string;
  thumbnailKey?: string | null;
}): boolean {
  return (
    media.type.toLowerCase().startsWith("image") ||
    (media.type === "VIDEO" && Boolean(media.thumbnailKey))
  );
}

// First previewable attachment of a post, absolute, or null when the post has
// none (videos without a stored thumbnail are skipped).
export function getPostImage(post: PostData): string | null {
  const media = post.attachments.find((attachment) =>
    isPreviewable(attachment)
  );
  return media ? absoluteUrl(toMediaProxyUrl(media)) : null;
}

// The image for a given media index (used by the shareable media route).
export function getMediaImage(post: PostData, index: number): string | null {
  const media = post.attachments[index];
  if (!media || !isPreviewable(media)) {
    return null;
  }
  return absoluteUrl(toMediaProxyUrl(media));
}
