import { beforeEach, expect, mock, test } from "bun:test";

import type {
  UploadOptions,
  UploadOutcome,
  UploadSource,
} from "@/features/media-upload/lib/upload-client";

import type { StagedAttachment } from "./message-attachment-upload";

let upload: (
  file: UploadSource,
  options: UploadOptions
) => Promise<UploadOutcome>;
const discard = mock(() => Promise.resolve());
mock.module("@/features/media-upload/lib/upload-client", () => ({
  UploadError: class UploadError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "UploadError";
    }
  },
  uploadMedia: (file: UploadSource, options: UploadOptions) =>
    upload(file, options),
}));
mock.module("./client", () => ({ discardMessageMedia: discard }));
mock.module("@/lib/api-env", () => ({
  getApiBaseUrl: () => "https://example.test",
}));
mock.module("@/lib/telemetry", () => ({ logWarn: () => {} }));
const { uploadStagedAttachments } = await import("./message-attachment-upload");

function draft(id: string): StagedAttachment {
  return {
    error: null,
    file: {
      mimeType: "image/jpeg",
      name: "photo.jpg",
      size: 10,
      uri: `file://${id}`,
    },
    id,
    mediaId: null,
    owned: false,
    progress: 0,
  };
}
beforeEach(() => {
  discard.mockClear();
});

test("the native composer waits for READY before enabling send", async () => {
  const pending = Promise.withResolvers<UploadOutcome>();
  upload = (_file, options) => {
    expect(options.waitForProcessing).toBe(true);
    options.onStage?.("processing");
    return pending.promise;
  };
  const patches: Partial<StagedAttachment>[] = [];
  const work = uploadStagedAttachments([draft("photo")], {
    aborts: { current: new Map() },
    conversationId: "chat",
    onPatch: (_id, patch) => patches.push(patch),
  });
  expect(patches).toEqual([{ progress: 100 }]);
  pending.resolve({ family: "IMAGE", mediaId: "uploaded", status: "READY" });
  await work;
  expect(patches.at(-1)).toEqual({ error: null, progress: null });
});

test("a failed deduplicated upload preserves the existing media row", async () => {
  upload = (_file, options) => {
    options.onMediaId?.("existing");
    options.onDeduplicated?.(true);
    return Promise.reject(new Error("offline"));
  };
  await uploadStagedAttachments([draft("photo")], {
    aborts: { current: new Map() },
    conversationId: "chat",
    onPatch: () => {},
  });
  expect(discard).not.toHaveBeenCalled();
});

test("a failed fresh upload reclaims only its owned media", async () => {
  upload = (_file, options) => {
    options.onMediaId?.("fresh");
    options.onDeduplicated?.(false);
    return Promise.reject(new Error("offline"));
  };
  await uploadStagedAttachments([draft("photo")], {
    aborts: { current: new Map() },
    conversationId: "chat",
    onPatch: () => {},
  });
  expect(discard).toHaveBeenCalledWith("fresh", expect.anything());
});

test("leaving the composer cancels queued uploads before they start", async () => {
  const pending = Promise.withResolvers<UploadOutcome>();
  let calls = 0;
  upload = () => {
    calls += 1;
    return pending.promise;
  };
  const aborts = { current: new Map<string, AbortController>() };
  const work = uploadStagedAttachments([draft("one"), draft("two")], {
    aborts,
    conversationId: "chat",
    onPatch: () => {},
  });
  for (const controller of aborts.current.values()) {
    controller.abort();
  }
  aborts.current.clear();
  pending.resolve({ family: "IMAGE", mediaId: "one", status: "READY" });
  await work;
  expect(calls).toBe(1);
});
