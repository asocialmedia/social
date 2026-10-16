export interface PreviewMedia {
  height?: number | null;
  mimeType?: string | null;
  type?: string | null;
  width?: number | null;
}

export interface PostPreviewSource {
  attachments?: readonly PreviewMedia[];
  content?: string | null;
  embeds?: unknown;
}

export function mediaAspect(media: PreviewMedia, fallback = 4 / 3): number {
  const { width, height } = media;
  return typeof width === "number" &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0
    ? width / height
    : fallback;
}

export function fitPreviewFrame(
  availableWidth: number,
  aspectRatio: number,
  maxHeight = 380
) {
  const ratio =
    Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 4 / 3;
  const width = Math.min(Math.max(availableWidth, 0), maxHeight * ratio);
  return { height: width / ratio, width };
}

export function postPreviewLayout(post?: PostPreviewSource | null) {
  const attachments = post?.attachments ?? [];
  const [first] = attachments;
  let textLines = 2;
  if (post) {
    textLines = 0;
    if (post.content?.trim()) {
      textLines = Math.min(4, Math.ceil(post.content.length / 72));
    }
  }
  if (!post) {
    return {
      aspectRatio: 4 / 3,
      count: 0,
      kind: "unknown" as const,
      textLines,
    };
  }
  if (attachments.length > 1) {
    return {
      aspectRatio: 3 / 2,
      count: attachments.length,
      kind: "album" as const,
      textLines,
    };
  }
  if (first) {
    const audio =
      first.type === "AUDIO" || first.mimeType?.startsWith("audio/");
    const video =
      first.type === "VIDEO" || first.mimeType?.startsWith("video/");
    let kind: "audio" | "video" | "image" = "image";
    if (video) {
      kind = "video";
    }
    if (audio) {
      kind = "audio";
    }
    return {
      aspectRatio: mediaAspect(first, video ? 16 / 9 : 4 / 3),
      count: 1,
      kind,
      textLines,
    };
  }

  const embedded = Array.isArray(post.embeds) && post.embeds.length > 0;
  return {
    aspectRatio: 16 / 9,
    count: 0,
    kind: embedded ? ("embed" as const) : ("text" as const),
    textLines,
  };
}
