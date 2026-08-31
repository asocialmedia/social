import { siteConfig } from "@asm/ui/meta/site";

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  return new URL(
    path.startsWith("/") ? path : `/${path}`,
    siteConfig.url
  ).toString();
}

// Generates a clean, URL-safe slug from post content (e.g. "use-of-free-will")
export function getPostSlug(content?: string | null): string {
  if (!content || typeof content !== "string") {
    return "";
  }
  // Strip URLs so external links don't corrupt the slug
  const withoutUrls = content.replaceAll(/https?:\/\/\S+/gi, "");

  // Strip code blocks and inline code
  const withoutCode = withoutUrls
    .replaceAll(/```[\s\S]*?```/g, " ")
    .replaceAll(/`[^`]*`/g, " ");

  // Normalize unicode accents, strip special chars/emojis, lowercase
  const cleaned = withoutCode
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replaceAll(/\s+/g, "-")
    .replaceAll(/-+/g, "-");

  if (!cleaned) {
    return "";
  }

  // Cap at 50 chars, breaking at word boundary if possible
  if (cleaned.length <= 50) {
    return cleaned.replaceAll(/^-+|-+$/g, "");
  }

  const truncated = cleaned.slice(0, 50);
  const lastHyphen = truncated.lastIndexOf("-");
  const result = (
    lastHyphen > 20 ? truncated.slice(0, lastHyphen) : truncated
  ).replaceAll(/^-+|-+$/g, "");

  return result;
}

export interface PostUrlTarget {
  content?: string | null;
  id: string;
  isGust?: boolean | null;
}

export function getShortPostId(id: string): string {
  if (!id) {
    return "";
  }
  return id.length > 8 ? id.slice(0, 8) : id;
}

// Default URL uses short post ID (8-char prefix) with human-readable content slug
export function getPostPath(post: PostUrlTarget): string {
  if (!post || !post.id) {
    return "/";
  }
  if (post.isGust) {
    return `/gusts?id=${post.id}`;
  }
  const shortId = getShortPostId(post.id);
  const slug = getPostSlug(post.content);
  return slug ? `/posts/${shortId}/${slug}` : `/posts/${shortId}`;
}

export function getPostUrl(post: PostUrlTarget): string {
  return absoluteUrl(getPostPath(post));
}

// Default post media URL uses short post ID (e.g. /posts/50769dc7/media/0)
export function getPostMediaPath(
  post: { id: string },
  index: number | string
): string {
  if (!post || !post.id) {
    return "/";
  }
  const shortId = getShortPostId(post.id);
  return `/posts/${shortId}/media/${index}`;
}

export function getPostMediaUrl(
  post: { id: string },
  index: number | string
): string {
  return absoluteUrl(getPostMediaPath(post, index));
}

export const getShortPostPath = getPostPath;
export const getShortPostUrl = getPostUrl;

// Full-length ID path helper if exact unshortened UUID is needed
export function getFullPostPath(post: PostUrlTarget): string {
  if (!post || !post.id) {
    return "/";
  }
  if (post.isGust) {
    return `/gusts?id=${post.id}`;
  }
  const slug = getPostSlug(post.content);
  return slug ? `/posts/${post.id}/${slug}` : `/posts/${post.id}`;
}

export function getFullPostUrl(post: PostUrlTarget): string {
  return absoluteUrl(getFullPostPath(post));
}
