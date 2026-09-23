// Web's publish gate for draft attachments, pure for unit tests:
// - anything errored blocks until retried or removed
// - anything still uploading blocks
// - posts attach before READY (web's waitForProcessing:false), so a tile
//   already finalized and "processing in background" does NOT block
// - eddies wait for READY (waitForProcessing:true)
import type { UploadStage } from "./upload-status";

export interface ReadinessItem {
  isProcessing: boolean;
  mediaId: string | null;
  stage: UploadStage;
  waitForProcessing: boolean;
}

export function scopeReadiness(items: readonly ReadinessItem[]): {
  hasError: boolean;
  isBusy: boolean;
  mediaIds: string[];
} {
  const hasError = items.some((item) => item.stage === "error");
  const isBusy = items.some((item) => {
    if (item.stage === "error") {
      return false;
    }
    if (item.waitForProcessing) {
      return item.stage !== "ready";
    }
    return !item.isProcessing && item.stage !== "ready";
  });
  return {
    hasError,
    isBusy,
    mediaIds: items
      .map((item) => item.mediaId)
      .filter((id): id is string => typeof id === "string"),
  };
}
