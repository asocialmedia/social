import { postHasExplicitMedia } from "@asm/protocols/discovery";

export function mediaContentIsExplicit(media: {
  safety?: unknown;
  altText?: string | null;
  ocrText?: string | null;
  post?: {
    content?: string | null;
    explicitContent?: boolean;
    semanticTags?: readonly string[] | null;
  } | null;
  comment?: {
    content?: string | null;
    post?: {
      content?: string | null;
      explicitContent?: boolean;
      semanticTags?: readonly string[] | null;
    } | null;
  } | null;
}) {
  return Boolean(
    (typeof media.safety === "object" &&
      media.safety !== null &&
      "explicit" in media.safety &&
      media.safety.explicit === true) ||
    postHasExplicitMedia({
      content: `${media.altText ?? ""} ${media.ocrText ?? ""}`,
    }) ||
    (media.post && postHasExplicitMedia(media.post)) ||
    (media.comment && postHasExplicitMedia(media.comment)) ||
    (media.comment?.post && postHasExplicitMedia(media.comment.post))
  );
}
