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
  // The owning community, when the post was published into one. Native
  // community posts live under the community's own namespace
  // (`/a/<slug>/posts/...`) rather than the global `/posts/...`; global posts
  // and reshares carry no community here and keep the default path.
  community?: { slug: string } | null;
  id: string;
  isGust?: boolean | null;
}

export function getShortPostId(id: string): string {
  if (!id) {
    return "";
  }
  return id.length > 8 ? id.slice(0, 8) : id;
}

// The URL prefix a post's detail/media URLs hang off. Community posts are
// nested under the community so the address names the space they belong to;
// everything else sits under /posts.
function postPathPrefix(post: PostUrlTarget): string {
  if (post.community?.slug) {
    return `/a/${post.community.slug}/posts`;
  }
  return "/posts";
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
  return slug
    ? `${postPathPrefix(post)}/${shortId}/${slug}`
    : `${postPathPrefix(post)}/${shortId}`;
}

export function getPostUrl(post: PostUrlTarget): string {
  return absoluteUrl(getPostPath(post));
}

// Default post media URL uses short post ID (e.g. /posts/50769dc7/media/0, or
// /a/anime/posts/50769dc7/media/0 inside a community).
export function getPostMediaPath(
  post: PostUrlTarget,
  index: number | string
): string {
  if (!post || !post.id) {
    return "/";
  }
  const shortId = getShortPostId(post.id);
  return `${postPathPrefix(post)}/${shortId}/media/${index}`;
}

export function getPostMediaUrl(
  post: PostUrlTarget,
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
  return slug
    ? `${postPathPrefix(post)}/${post.id}/${slug}`
    : `${postPathPrefix(post)}/${post.id}`;
}

export function getFullPostUrl(post: PostUrlTarget): string {
  return absoluteUrl(getFullPostPath(post));
}

// Reconstructs the path a post request was made with, from route params. Used
// by the detail/media routes to detect a non-canonical URL (wrong community,
// wrong slug, or the global /posts path for a community post) and redirect to
// the single canonical address.
export function buildPostRequestPath(params: {
  communitySlug?: string;
  postId: string;
  slug?: string;
}): string {
  const base = params.communitySlug
    ? `/a/${params.communitySlug}/posts/${params.postId}`
    : `/posts/${params.postId}`;
  return params.slug ? `${base}/${params.slug}` : base;
}

export function buildPostMediaRequestPath(params: {
  communitySlug?: string;
  index: number | string;
  postId: string;
}): string {
  const base = params.communitySlug
    ? `/a/${params.communitySlug}/posts/${params.postId}`
    : `/posts/${params.postId}`;
  return `${base}/media/${params.index}`;
}
