import { beforeEach, describe, expect, mock, test } from "bun:test";

import React from "react";
import { renderToString } from "react-dom/server";

import type { CommentAttachmentDraft } from "./use-comment-attachments";

const mockUploadMediaFile = mock(() =>
  Promise.resolve({ mediaId: "media-mock-1", status: "READY" })
);
const mockToast = mock(() => {});

mock.module("@/lib/media-upload-client", () => ({
  uploadMediaFile: mockUploadMediaFile,
}));

mock.module("@/lib/gooey-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

globalThis.URL.createObjectURL = mock(() => "blob:mock-url");
globalThis.URL.revokeObjectURL = mock(() => {});

const { useCommentAttachments } = await import("./use-comment-attachments");

interface ReactClientInternals {
  H: unknown;
}

function getReactInternals(): ReactClientInternals {
  const reactObj = React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactClientInternals;
  };
  return reactObj.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
}

function TestComponent() {
  const { attachments, isUploading, mediaIds } = useCommentAttachments();
  return React.createElement(
    "div",
    null,
    React.createElement(
      "span",
      { "data-testid": "count" },
      `${attachments.length}`
    ),
    React.createElement(
      "span",
      { "data-testid": "uploading" },
      `${isUploading}`
    ),
    React.createElement(
      "span",
      { "data-testid": "media-count" },
      `${mediaIds.length}`
    )
  );
}

describe("useCommentAttachments", () => {
  beforeEach(() => {
    mockUploadMediaFile.mockClear();
    mockToast.mockClear();
  });

  test("renders initial empty state", () => {
    const html = renderToString(React.createElement(TestComponent));
    expect(html).toContain(">0<");
    expect(html).toContain(">false<");
  });

  test("enforces attachment limit of 1: retains exactly 1 attachment and media ID", async () => {
    const internals = getReactInternals();
    const prevDispatcher = internals.H;

    let attachmentsState: CommentAttachmentDraft[] = [];
    let isUploadingState = false;
    let hookIndex = 0;

    internals.H = {
      useCallback: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
      useContext: () => ({ toast: mockToast }),
      useEffect: () => {},
      useMemo: <T>(fn: () => T): T => fn(),
      useRef: <T>(val: T) => ({ current: val }),
      useState: () => {
        const idx = hookIndex;
        hookIndex += 1;
        if (idx === 0) {
          return [
            attachmentsState,
            (valOrFn: unknown) => {
              attachmentsState =
                typeof valOrFn === "function"
                  ? (
                      valOrFn as (
                        prev: CommentAttachmentDraft[]
                      ) => CommentAttachmentDraft[]
                    )(attachmentsState)
                  : (valOrFn as CommentAttachmentDraft[]);
            },
          ];
        }
        return [
          isUploadingState,
          (valOrFn: unknown) => {
            isUploadingState =
              typeof valOrFn === "function"
                ? (valOrFn as (prev: boolean) => boolean)(isUploadingState)
                : Boolean(valOrFn);
          },
        ];
      },
    };

    try {
      hookIndex = 0;
      let hook = useCommentAttachments();
      expect(hook.attachments.length).toBe(0);
      expect(hook.mediaIds.length).toBe(0);

      // 1st attachment upload
      const file1 = new File(["img1"], "photo.png", { type: "image/png" });
      await hook.startUpload([file1]);

      hookIndex = 0;
      hook = useCommentAttachments();
      expect(hook.attachments.length).toBe(1);
      expect(hook.mediaIds).toEqual(["media-mock-1"]);
      expect(mockUploadMediaFile).toHaveBeenCalledTimes(1);

      // Attempt 2nd attachment upload
      const file2 = new File(["img2"], "photo2.gif", { type: "image/gif" });
      await hook.startUpload([file2]);

      hookIndex = 0;
      hook = useCommentAttachments();
      // Must still retain exactly one attachment and one media ID
      expect(hook.attachments.length).toBe(1);
      expect(hook.mediaIds).toEqual(["media-mock-1"]);
      expect(mockToast).toHaveBeenCalled();
      expect(mockUploadMediaFile).toHaveBeenCalledTimes(1);
    } finally {
      internals.H = prevDispatcher;
    }
  });
});
