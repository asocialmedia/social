// Web's publish gate for draft attachments, pure for unit tests:
// - anything errored or detached blocks until retried or removed
// - uploading always blocks
// - posts attach before READY (web's waitForProcessing:false), so a tile
//   already finalized and "processing in background" does NOT block
// - eddies wait for READY (waitForProcessing:true)
import type { AttachmentStatus } from "../state/attachment-store";

export interface ReadinessItem {
  error: string | null;
  mediaId: string | null;
  status: AttachmentStatus;
  waitForProcessing: boolean;
}

export function scopeReadiness(items: readonly ReadinessItem[]): {
  hasError: boolean;
  isBusy: boolean;
  mediaIds: string[];
} {
  const hasError = items.some(
    (item) => item.status === "error" || item.status === "detached"
  );
  const isBusy = items.some((item) => {
    if (item.status === "error" || item.status === "detached") {
      return false;
    }
    if (item.status === "ready") {
      return false;
    }
    if (item.waitForProcessing) {
      return true;
    }
    return item.status === "uploading";
  });
  return {
    hasError,
    isBusy,
    mediaIds: items
      .map((item) => item.mediaId)
      .filter((id): id is string => typeof id === "string"),
  };
}
