import { MediaViewerSkeleton } from "@/components/layouts/skeletons/media-viewer-skeleton";

export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <MediaViewerSkeleton className="max-h-[85vh] max-w-[90vw]" type="IMAGE" />
    </div>
  );
}
