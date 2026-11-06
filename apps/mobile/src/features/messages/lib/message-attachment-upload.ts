import {
  UploadError,
  uploadMedia,
} from "@/features/media-upload/lib/upload-client";
import type { PickedMedia } from "@/features/media-upload/state/attachment-store";
import { logWarn } from "@/lib/lifecycle/telemetry";
import { getApiBaseUrl } from "@/lib/network/api-env";

import { discardMessageMedia } from "./client";

export interface StagedAttachment {
  error: string | null;
  file: PickedMedia;
  id: string;
  mediaId: string | null;
  // Null only when processing has finished or failed.
  progress: number | null;
  owned: boolean;
  viewOnce?: boolean;
}

interface UploadContext {
  aborts: { current: Map<string, AbortController> };
  conversationId: string;
  incognitoSessionId?: string;
  onPatch: (id: string, patch: Partial<StagedAttachment>) => void;
}

export async function uploadStagedAttachments(
  staged: StagedAttachment[],
  context: UploadContext
): Promise<void> {
  // Register queued transfers too, so leaving the screen cancels the complete selection.
  for (const item of staged) {
    context.aborts.current.set(item.id, new AbortController());
  }
  for (const item of staged) {
    const controller = context.aborts.current.get(item.id);
    if (!controller || controller.signal.aborted) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- Keep native transfers sequential on the device connection.
    await uploadAttachment(item, context, controller);
  }
}

async function uploadAttachment(
  item: StagedAttachment,
  context: UploadContext,
  controller: AbortController
): Promise<void> {
  let { owned } = item;
  let { mediaId } = item;
  try {
    const result = await uploadMedia(item.file, {
      conversationId: context.conversationId,
      incognitoSessionId: context.incognitoSessionId,
      onBytes: (progress) => context.onPatch(item.id, { progress }),
      onDeduplicated: (deduplicated) => {
        owned = !deduplicated;
        context.onPatch(item.id, { owned });
      },
      onMediaId: (id) => {
        mediaId = id;
        context.onPatch(item.id, { mediaId });
      },
      onStage: () => context.onPatch(item.id, { progress: 100 }),
      purpose: "message",
      signal: controller.signal,
      viewOnce: item.viewOnce,
      waitForProcessing: true,
    });
    if (controller.signal.aborted && mediaId && owned) {
      await discardMessageMedia(mediaId, {
        apiBase: getApiBaseUrl(),
        baseFetch: fetch,
      });
    }
    if (!controller.signal.aborted) {
      context.onPatch(item.id, {
        error:
          result.status === "READY"
            ? null
            : "This attachment is still processing. Try again.",
        progress: null,
      });
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      logWarn("message attachment upload failed", {
        step: error instanceof UploadError ? error.step : "upload",
      });
      context.onPatch(item.id, {
        error:
          error instanceof UploadError ? error.userMessage : "Upload failed",
        progress: null,
      });
    }
    if (mediaId && owned) {
      await discardMessageMedia(mediaId, {
        apiBase: getApiBaseUrl(),
        baseFetch: fetch,
      });
    }
  } finally {
    if (context.aborts.current.get(item.id) === controller) {
      context.aborts.current.delete(item.id);
    }
  }
}
