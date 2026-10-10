import { create } from "zustand";

import { isAbortError } from "@/features/media-upload/lib/retry";
import {
  apiJson,
  discardDraftMedia,
} from "@/features/media-upload/lib/upload-api";
import { uploadMedia } from "@/features/media-upload/lib/upload-client";
import { attachmentActions } from "@/features/media-upload/state/attachment-store";
import type { PickedMedia } from "@/features/media-upload/state/attachment-store";

import {
  gustAssetPatch,
  gustAssetRoute,
  prepareGustAsset,
} from "../lib/gust-options";
import type { GustAssetKind } from "../lib/gust-options";

export interface GustAssetDraft {
  file: PickedMedia;
  readyMediaId?: string;
  status: "error" | "ready" | "uploading";
  percent: number;
}

interface GustOptions {
  altText?: string;
  busy: boolean;
  error?: string;
  sound?: GustAssetDraft;
  thumbnail?: GustAssetDraft;
  thumbRevision: number;
}

const EMPTY: GustOptions = { busy: false, thumbRevision: 0 };
const useOptions = create<{ drafts: Record<string, GustOptions> }>(() => ({
  drafts: {},
}));
const operations = new Map<string, AbortController>();

function update(localId: string, changes: Partial<GustOptions>) {
  useOptions.setState((state) => ({
    drafts: {
      ...state.drafts,
      [localId]: { ...(state.drafts[localId] ?? EMPTY), ...changes },
    },
  }));
}

export function useGustOptions(localId: string) {
  return useOptions((state) => state.drafts[localId] ?? EMPTY);
}

export function setGustAlt(localId: string, altText: string) {
  update(localId, { altText });
}

export function carryGustSound(localId: string, sound: GustAssetDraft) {
  if (sound.status === "ready") {
    update(localId, { sound });
  }
}

export async function flushGustAlt(localId: string): Promise<void> {
  const alt = useOptions.getState().drafts[localId]?.altText;
  if (
    alt !== undefined &&
    !(await attachmentActions.setAltText(localId, alt.trim()))
  ) {
    throw new Error(
      "Couldn't save the video's alt text. Try again before posting."
    );
  }
}

// Lives outside React so the inline and modal composers share one upload and one patch.
export async function setGustAsset(
  localId: string,
  videoId: string,
  kind: GustAssetKind,
  file: PickedMedia
): Promise<void> {
  if (useOptions.getState().drafts[localId]?.busy) {
    return;
  }
  const controller = new AbortController();
  operations.set(localId, controller);
  const previous = useOptions.getState().drafts[localId]?.[kind];
  let draft: GustAssetDraft = {
    file,
    percent: 0,
    readyMediaId:
      previous?.file.uri === file.uri ? previous.readyMediaId : undefined,
    status: "uploading",
  };
  update(localId, { [kind]: draft, busy: true, error: undefined });
  let uploadedId: string | undefined;
  const isCurrent = () =>
    operations.get(localId) === controller && !controller.signal.aborted;
  try {
    const mediaId = await prepareGustAsset({
      existingReadyId: draft.readyMediaId,
      isCurrent,
      onUploaded: (id) => {
        uploadedId = id;
        draft = { ...draft, readyMediaId: id };
        if (isCurrent()) {
          update(localId, { [kind]: draft });
        }
      },
      patch: (id) =>
        apiJson(gustAssetRoute(videoId, kind), {
          body: gustAssetPatch(kind, id),
          method: "PATCH",
          signal: controller.signal,
        }),
      upload: () =>
        uploadMedia(file, {
          onBytes: (percent) => {
            draft = { ...draft, percent };
            if (isCurrent()) {
              update(localId, { [kind]: draft });
            }
          },
          onMediaId: (id) => {
            uploadedId = id;
          },
          purpose: "post",
          signal: controller.signal,
          waitForProcessing: true,
        }),
    });
    if (mediaId && isCurrent()) {
      update(localId, {
        [kind]: {
          ...draft,
          percent: 100,
          readyMediaId: mediaId,
          status: "ready",
        },
        busy: false,
        thumbRevision: Date.now(),
      });
    } else if (uploadedId) {
      await discardDraftMedia(uploadedId);
    }
  } catch (error) {
    if (isCurrent() && !isAbortError(error)) {
      update(localId, {
        [kind]: { ...draft, status: "error" },
        busy: false,
        error:
          error instanceof Error
            ? error.message
            : "Couldn't attach that file. Try again.",
      });
    } else if (uploadedId) {
      await discardDraftMedia(uploadedId);
    }
  }
  if (operations.get(localId) === controller) {
    operations.delete(localId);
  }
}

export async function removeGustAsset(
  localId: string,
  videoId: string,
  kind: GustAssetKind
): Promise<void> {
  if (useOptions.getState().drafts[localId]?.busy) {
    return;
  }
  const controller = new AbortController();
  operations.set(localId, controller);
  const isCurrent = () =>
    operations.get(localId) === controller && !controller.signal.aborted;
  update(localId, { busy: true, error: undefined });
  try {
    await apiJson(gustAssetRoute(videoId, kind), {
      body: gustAssetPatch(kind, null),
      method: "PATCH",
      signal: controller.signal,
    });
    if (isCurrent()) {
      update(localId, {
        [kind]: undefined,
        busy: false,
        thumbRevision: Date.now(),
      });
    }
  } catch (error) {
    if (isCurrent() && !isAbortError(error)) {
      update(localId, {
        busy: false,
        error:
          error instanceof Error
            ? error.message
            : "Couldn't remove that option. Try again.",
      });
    }
  }
  if (operations.get(localId) === controller) {
    operations.delete(localId);
  }
}

export function clearGustOptions(localId: string) {
  operations.get(localId)?.abort();
  operations.delete(localId);
  useOptions.setState((state) => ({
    drafts: Object.fromEntries(
      Object.entries(state.drafts).filter(([key]) => key !== localId)
    ),
  }));
}
