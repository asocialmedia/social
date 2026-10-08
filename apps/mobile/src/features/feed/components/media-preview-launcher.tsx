import { lazy, Suspense } from "react";

import { useMediaPreviewStore } from "../state/media-preview-store";

const MediaPreview = lazy(async () => {
  const previewModule = await import("./media-preview");
  return { default: previewModule.MediaPreview };
});

export function MediaPreviewLauncher() {
  const request = useMediaPreviewStore((state) => state.request);
  return request ? (
    <Suspense fallback={null}>
      <MediaPreview
        key={`${request.post.id}:${request.media.id}`}
        request={request}
      />
    </Suspense>
  ) : null;
}
