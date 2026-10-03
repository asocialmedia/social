import { describe, expect, mock, test } from "bun:test";

// The upload is the whole of the bug, so it is asserted directly rather than
// through the dialog. The dialog is a 500-line component wired to the session,
// the identity key and the member picker; this function is the part that decides
// which door the bytes go through, and it is a module-scope export for exactly
// this reason.
const uploadMediaFile = mock(() =>
  Promise.resolve({
    mediaId: "media-1",
    rejectedReason: null,
    status: "READY" as const,
  })
);

mock.module("@/lib/media/media-upload-client", () => ({
  uploadMediaFile,
}));

const { uploadDenAvatar } =
  await import("@/components/messages/create-den-dialog");

function file(): File {
  return new File([new Uint8Array([1, 2, 3])], "pic.png", {
    type: "image/png",
  });
}

describe("a den avatar upload", () => {
  test("is an avatar, not a message attachment", async () => {
    // The failure this pins. A den avatar is chosen in the create sheet, BEFORE
    // the den exists, so there is no conversation to bind the upload to. Uploading
    // it as `purpose: "message"` asks the initiate route for a conversation it
    // cannot have, and the route refuses — which is why picking a group picture
    // reported that attachments could only be sent when messages are there.
    uploadMediaFile.mockClear();
    const result = await uploadDenAvatar(file(), () => {});

    expect(result).toEqual({ mediaId: "media-1" });
    const options = uploadMediaFile.mock.calls[0]?.[1] as
      | { messageConversationId?: string | null; purpose?: string }
      | undefined;
    expect(options?.purpose).toBe("avatar");
    expect(options?.messageConversationId ?? null).toBeNull();
  });

  test("reports the pipeline's own refusal rather than throwing", async () => {
    uploadMediaFile.mockImplementationOnce(() =>
      Promise.resolve({
        mediaId: "media-1",
        rejectedReason: "MALWARE",
        status: "REJECTED" as const,
      })
    );
    expect(await uploadDenAvatar(file(), () => {})).toEqual({
      error: "That file failed the security scan",
    });
  });
});
