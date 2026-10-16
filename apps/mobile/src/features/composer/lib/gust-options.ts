export type GustAssetKind = "sound" | "thumbnail";

export function gustAssetPatch(kind: GustAssetKind, mediaId: string | null) {
  return kind === "sound"
    ? { audioOverlayId: mediaId }
    : { thumbnailMediaId: mediaId };
}

export function gustAssetRoute(videoId: string, kind: GustAssetKind): string {
  return `/api/media/${encodeURIComponent(videoId)}/${kind === "sound" ? "audio-overlay" : "thumbnail"}`;
}

export async function prepareGustAsset(options: {
  existingReadyId?: string;
  isCurrent: () => boolean;
  onUploaded: (mediaId: string) => void;
  patch: (mediaId: string) => Promise<unknown>;
  upload: () => Promise<{ mediaId: string; status: string }>;
}): Promise<string | null> {
  let mediaId = options.existingReadyId;
  if (!mediaId) {
    const result = await options.upload();
    if (result.status !== "READY") {
      throw new Error("This file is still processing. Try again shortly.");
    }
    ({ mediaId } = result);
    options.onUploaded(mediaId);
  }
  if (!options.isCurrent()) {
    return null;
  }
  await options.patch(mediaId);
  return options.isCurrent() ? mediaId : null;
}

// Explicit picker selections survive without a matching token in the caption.
export function gustRelations(
  inline: { mentions: string[]; tags: string[] },
  explicit: { mentions?: readonly { id: string }[]; tags?: readonly string[] }
) {
  return {
    mentions: [
      ...new Set([
        ...inline.mentions,
        ...(explicit.mentions ?? []).map((user) => user.id),
      ]),
    ],
    tags: [
      ...new Set([
        ...inline.tags,
        ...(explicit.tags ?? []).map((tag) => tag.toLowerCase()),
      ]),
    ],
  };
}
