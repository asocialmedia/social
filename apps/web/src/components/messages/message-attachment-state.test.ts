import { describe, expect, test } from "bun:test";

import {
  MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES,
  MAX_MESSAGE_ATTACHMENTS,
} from "@asm/media";

import type {
  MessageAttachmentDraft,
  StagedMediaId,
} from "./message-attachment-state";
import {
  claimStagedMedia,
  groupReadyAttachments,
  hasUploading,
  isAllowedMessageAttachment,
  isMediaReferenced,
  isReadyToSend,
  kindForFile,
  restoreStagedMedia,
  selectAcceptedFiles,
} from "./message-attachment-state";

function file(name: string, type: string): File {
  return new File(["x"], name, { type });
}

function draft(
  overrides: Partial<MessageAttachmentDraft> & { id: string }
): MessageAttachmentDraft {
  return {
    bytes: 1,
    durationSec: null,
    file: file("a.png", "image/png"),
    filename: "a.png",
    height: 100,
    kind: "image",
    mimeType: "image/png",
    objectUrl: `blob:${overrides.id}`,
    progress: 100,
    stage: "processing",
    status: "ready",
    width: 100,
    ...overrides,
  };
}

function entries(
  ...pairs: [string, StagedMediaId][]
): Map<string, StagedMediaId> {
  return new Map(pairs);
}

describe("isAllowedMessageAttachment", () => {
  test("accepts photos, GIFs, videos, audio and safe documents", () => {
    expect(isAllowedMessageAttachment(file("a.png", "image/png"))).toBe(true);
    expect(isAllowedMessageAttachment(file("a.jpg", "image/jpeg"))).toBe(true);
    expect(isAllowedMessageAttachment(file("a.gif", "image/gif"))).toBe(true);
    expect(isAllowedMessageAttachment(file("a.mp4", "video/mp4"))).toBe(true);
    expect(isAllowedMessageAttachment(file("a.mp3", "audio/mpeg"))).toBe(true);
    expect(isAllowedMessageAttachment(file("a.pdf", "application/pdf"))).toBe(
      true
    );
  });

  test("rejects active and unsupported content", () => {
    expect(isAllowedMessageAttachment(file("a.svg", "image/svg+xml"))).toBe(
      false
    );
    expect(isAllowedMessageAttachment(file("a.html", "text/html"))).toBe(false);
    expect(
      isAllowedMessageAttachment(file("a.exe", "application/octet-stream"))
    ).toBe(false);
  });
});

describe("kindForFile", () => {
  test("marks GIFs distinctly so their animation is preserved on render", () => {
    expect(kindForFile(file("a.gif", "image/gif"))).toBe("gif");
    expect(kindForFile(file("a.png", "image/png"))).toBe("image");
    expect(kindForFile(file("a.webp", "image/webp"))).toBe("image");
    expect(kindForFile(file("a.mp4", "video/mp4"))).toBe("video");
    expect(kindForFile(file("a.pdf", "application/pdf"))).toBe("file");
  });
});

describe("selectAcceptedFiles", () => {
  test("accepts everything under the cap", () => {
    const files = [file("a.png", "image/png"), file("b.gif", "image/gif")];
    const result = selectAcceptedFiles(0, files);
    expect(result.accepted).toEqual(files);
    expect(result.overflow).toBe(0);
    expect(result.rejected).toBe(0);
  });

  test("caps at the remaining capacity and reports overflow", () => {
    const files = Array.from({ length: 12 }, (_, index) =>
      file(`${index}.png`, "image/png")
    );
    const result = selectAcceptedFiles(MAX_MESSAGE_ATTACHMENTS - 3, files);
    expect(result.accepted).toHaveLength(3);
    expect(result.overflow).toBe(9);
    expect(result.rejected).toBe(0);
  });

  test("separates unsupported files from the cap math", () => {
    const result = selectAcceptedFiles(0, [
      file("a.png", "image/png"),
      file("a.svg", "image/svg+xml"),
      file("a.pdf", "application/pdf"),
      file("b.gif", "image/gif"),
    ]);
    expect(result.accepted).toHaveLength(3);
    expect(result.rejected).toBe(1);
    expect(result.overflow).toBe(0);
  });

  test("accepts nothing when already at capacity", () => {
    const result = selectAcceptedFiles(MAX_MESSAGE_ATTACHMENTS, [
      file("a.png", "image/png"),
    ]);
    expect(result.accepted).toHaveLength(0);
    expect(result.overflow).toBe(1);
  });
});

describe("readiness", () => {
  test("isReadyToSend requires at least one fully-uploaded item", () => {
    expect(isReadyToSend([])).toBe(false);
    expect(isReadyToSend([draft({ id: "1", status: "uploading" })])).toBe(
      false
    );
    expect(isReadyToSend([draft({ id: "1", status: "error" })])).toBe(false);
    expect(isReadyToSend([draft({ id: "1" })])).toBe(true);
    expect(
      isReadyToSend([
        draft({ id: "1" }),
        draft({ id: "2", status: "uploading" }),
      ])
    ).toBe(false);
  });

  test("hasUploading reports any in-flight item", () => {
    expect(hasUploading([draft({ id: "1" })])).toBe(false);
    expect(hasUploading([draft({ id: "1", status: "uploading" })])).toBe(true);
  });
});

describe("groupReadyAttachments", () => {
  test("groups mixed media into one typed payload preserving the selected order", () => {
    const groups = groupReadyAttachments([
      draft({ id: "img1", kind: "image", mediaUrl: "/api/media/1" }),
      draft({ id: "gif1", kind: "gif", mediaUrl: "/api/media/2" }),
      draft({
        id: "video1",
        kind: "video",
        mediaUrl: "/api/media/3",
        mimeType: "video/mp4",
      }),
      draft({
        bytes: 120,
        filename: "report.pdf",
        id: "file1",
        kind: "file",
        mediaUrl: "/api/media/4",
        mimeType: "application/pdf",
      }),
      draft({ id: "img2", kind: "image", mediaUrl: "/api/media/5" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      attachmentIds: ["img1", "gif1", "video1", "file1", "img2"],
      attachments: [
        { height: 100, kind: "image", url: "/api/media/1", width: 100 },
        { height: 100, kind: "gif", url: "/api/media/2", width: 100 },
        { height: 100, kind: "video", url: "/api/media/3", width: 100 },
        {
          bytes: 120,
          filename: "report.pdf",
          kind: "file",
          mimeType: "application/pdf",
          url: "/api/media/4",
        },
        { height: 100, kind: "image", url: "/api/media/5", width: 100 },
      ],
    });
  });

  test("skips items that are not ready or have no media url", () => {
    const groups = groupReadyAttachments([
      draft({ id: "1", mediaUrl: undefined, status: "uploading" }),
      draft({ id: "2", mediaUrl: undefined, status: "error" }),
      draft({ id: "3", mediaUrl: undefined }),
    ]);
    expect(groups).toEqual([]);
  });

  test("drops null dimensions from the encrypted payload", () => {
    const groups = groupReadyAttachments([
      draft({ height: null, id: "1", mediaUrl: "/api/media/1", width: null }),
    ]);
    expect(groups[0].attachments[0]).toEqual({
      kind: "image",
      url: "/api/media/1",
    });
  });

  test("encodes a view-once photo as a protected media reference", () => {
    const groups = groupReadyAttachments([
      draft({
        id: "once",
        mediaId: "protected-media-id",
        mediaUrl: "/api/media/protected-media-id",
        viewOnce: true,
      }),
    ]);

    expect(groups[0]).toEqual({
      attachmentIds: ["once"],
      attachments: [
        { height: 100, kind: "view-once", ref: "protected-media-id" },
      ],
    });
  });

  test("rejects per-file and aggregate size excess before upload", () => {
    const result = selectAcceptedFiles(
      0,
      [
        new File([new Uint8Array(26 * 1024 * 1024)], "large.png", {
          type: "image/png",
        }),
        file("small.pdf", "application/pdf"),
      ],
      MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.tooLarge).toBe(2);
  });
});

describe("isMediaReferenced", () => {
  test("detects another draft still holding the same media row", () => {
    const map = entries(
      ["a", { mediaId: "m1", owned: true }],
      ["b", { mediaId: "m1", owned: false }]
    );
    expect(isMediaReferenced(map, "m1", new Set(["a"]))).toBe(true);
  });

  test("ignores drafts that are part of the same removal batch", () => {
    const map = entries(
      ["a", { mediaId: "m1", owned: true }],
      ["b", { mediaId: "m1", owned: false }]
    );
    expect(isMediaReferenced(map, "m1", new Set(["a", "b"]))).toBe(false);
  });

  test("returns false when the last reference is gone", () => {
    const map = entries(["a", { mediaId: "m1", owned: true }]);
    expect(isMediaReferenced(map, "m1", new Set(["a"]))).toBe(false);
  });

  test("distinguishes media ids", () => {
    const map = entries(
      ["a", { mediaId: "m1", owned: true }],
      ["b", { mediaId: "m2", owned: true }]
    );
    expect(isMediaReferenced(map, "m1", new Set(["a"]))).toBe(false);
  });
});

describe("claimStagedMedia", () => {
  test("detaches the group so the unmount sweep cannot discard it", () => {
    const map = entries(
      ["a", { mediaId: "m1", owned: true }],
      ["b", { mediaId: "m2", owned: true }]
    );
    const claimed = claimStagedMedia(map, ["a"]);
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(true);
    expect(claimed.get("a")).toEqual({ mediaId: "m1", owned: true });
  });

  test("claims a whole group, so no sent row stays discardable", () => {
    const map = entries(
      ["a", { mediaId: "m1", owned: true }],
      ["b", { mediaId: "m2", owned: true }],
      ["c", { mediaId: "m3", owned: true }]
    );
    claimStagedMedia(map, ["a", "b"]);
    expect([...map.keys()]).toEqual(["c"]);
  });

  test("tolerates ids that never registered a row", () => {
    const map = entries(["a", { mediaId: "m1", owned: true }]);
    const claimed = claimStagedMedia(map, ["a", "missing"]);
    expect(map.size).toBe(0);
    expect(claimed.get("missing")).toBeUndefined();
  });
});

describe("restoreStagedMedia", () => {
  test("re-stages a group whose send never landed", () => {
    const map = entries(
      ["a", { mediaId: "m1", owned: true }],
      ["b", { mediaId: "m2", owned: true }]
    );
    const claimed = claimStagedMedia(map, ["a", "b"]);
    expect(map.size).toBe(0);
    restoreStagedMedia(map, claimed);
    expect(map.get("a")).toEqual({ mediaId: "m1", owned: true });
    expect(map.get("b")).toEqual({ mediaId: "m2", owned: true });
  });

  test("does not clobber a row registered since the claim", () => {
    const map = entries();
    const claimed = claimStagedMedia(
      entries(["a", { mediaId: "m1", owned: true }]),
      ["a"]
    );
    map.set("a", { mediaId: "m9", owned: true });
    restoreStagedMedia(map, claimed);
    expect(map.get("a")).toEqual({ mediaId: "m9", owned: true });
  });
});
