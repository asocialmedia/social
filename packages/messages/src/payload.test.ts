import { describe, expect, test } from "bun:test";

import { MAX_MESSAGE_ATTACHMENTS } from "@asm/media";
import { parseMessagePayload } from "@asm/messages/payload";

describe("parseMessagePayload", () => {
  test("accepts legacy and grouped media payloads", () => {
    expect(
      parseMessagePayload(
        JSON.stringify({
          kind: "image",
          type: "media",
          url: "/api/media/legacy",
        })
      )
    ).toMatchObject({ kind: "image", type: "media" });
    expect(
      parseMessagePayload(
        JSON.stringify({
          images: [{ url: "/api/media/one" }, { url: "/api/media/two" }],
          kind: "image",
          type: "media",
        })
      )
    ).toMatchObject({ kind: "image", type: "media" });
  });

  test("rejects malformed payloads and unsafe media URLs", () => {
    const unsafeUrl = ["java", "script:alert(1)"].join("");
    expect(() => parseMessagePayload('{"type":"unknown"}')).toThrow(
      "Invalid message payload"
    );
    expect(() =>
      parseMessagePayload(
        JSON.stringify({
          kind: "image",
          type: "media",
          url: unsafeUrl,
        })
      )
    ).toThrow("Invalid media payload");
    expect(() =>
      parseMessagePayload(
        JSON.stringify({ images: [], kind: "image", type: "media" })
      )
    ).toThrow("Invalid media payload");
  });

  test("accepts version-2 attachment lists with per-item kinds", () => {
    const parsed = parseMessagePayload(
      JSON.stringify({
        attachments: [
          { height: 90, kind: "image", url: "/api/media/one", width: 160 },
          { kind: "gif", url: "/api/media/two" },
          {
            durationSec: 30,
            height: 720,
            kind: "video",
            posterUrl: "/api/media/three/v/thumb.jpg",
            url: "/api/media/three",
            width: 1280,
          },
          {
            bytes: 4096,
            filename: "notes.pdf",
            kind: "file",
            mimeType: "application/pdf",
            url: "/api/media/four",
          },
        ],
        type: "media",
      })
    );
    expect(parsed).toMatchObject({
      attachments: [
        { kind: "image" },
        { kind: "gif" },
        { durationSec: 30, kind: "video" },
        { filename: "notes.pdf", kind: "file" },
      ],
      type: "media",
    });
  });

  test("accepts a lone view-once reference and rejects its misuse", () => {
    const viewOnce = {
      attachments: [{ height: 1200, kind: "view-once", ref: "media_abc123" }],
      type: "media",
    };
    expect(parseMessagePayload(JSON.stringify(viewOnce))).toMatchObject({
      attachments: [{ kind: "view-once", ref: "media_abc123" }],
      type: "media",
    });
    // A protected item must not smuggle a fetchable URL...
    expect(() =>
      parseMessagePayload(
        JSON.stringify({
          attachments: [
            {
              kind: "view-once",
              ref: "media_abc123",
              url: "https://cdn.example.com/a.png",
            },
          ],
          type: "media",
        })
      )
    ).toThrow("Invalid media payload");
    // ...ride along with ordinary attachments, or carry a caption.
    expect(() =>
      parseMessagePayload(
        JSON.stringify({
          attachments: [
            { kind: "view-once", ref: "media_abc123" },
            { kind: "image", url: "/api/media/one" },
          ],
          type: "media",
        })
      )
    ).toThrow("Invalid media payload");
    expect(() =>
      parseMessagePayload(JSON.stringify({ ...viewOnce, content: "hi" }))
    ).toThrow("Invalid media caption");
  });

  test("rejects oversized or malformed attachment lists", () => {
    const image = { kind: "image", url: "/api/media/one" };
    expect(() =>
      parseMessagePayload(
        JSON.stringify({
          attachments: Array.from(
            { length: MAX_MESSAGE_ATTACHMENTS + 1 },
            () => image
          ),
          type: "media",
        })
      )
    ).toThrow("Invalid media payload");
    expect(() =>
      parseMessagePayload(
        JSON.stringify({
          attachments: [{ kind: "image", url: image.url, width: 0 }],
          type: "media",
        })
      )
    ).toThrow("Invalid media payload");
    expect(() =>
      parseMessagePayload(
        JSON.stringify({
          attachments: [
            {
              bytes: -1,
              filename: "notes.pdf",
              kind: "file",
              url: image.url,
            },
          ],
          type: "media",
        })
      )
    ).toThrow("Invalid media payload");
    expect(() =>
      parseMessagePayload(
        JSON.stringify({
          attachments: [
            {
              durationSec: 0,
              kind: "video",
              url: image.url,
            },
          ],
          type: "media",
        })
      )
    ).toThrow("Invalid media payload");
    expect(() =>
      parseMessagePayload(
        JSON.stringify({
          attachments: [{ kind: "video", url: "https://cdn.example.com/x" }],
          type: "media",
        })
      )
    ).not.toThrow();
  });

  test("gates plain-http-adjacent hosts behind the explicit URL policy", () => {
    const emulatorPayload = JSON.stringify({
      attachments: [{ kind: "image", url: "http://10.0.2.2/api/media/one" }],
      type: "media",
    });
    expect(() => parseMessagePayload(emulatorPayload)).toThrow(
      "Invalid media payload"
    );
    expect(() =>
      parseMessagePayload(emulatorPayload, {
        allowEmulatorHost: true,
        allowLoopbackHttp: true,
      })
    ).not.toThrow();
    const loopbackPayload = JSON.stringify({
      attachments: [{ kind: "image", url: "http://localhost/api/media/one" }],
      type: "media",
    });
    expect(() =>
      parseMessagePayload(loopbackPayload, { allowLoopbackHttp: false })
    ).toThrow("Invalid media payload");
    expect(() =>
      parseMessagePayload(loopbackPayload, { allowLoopbackHttp: true })
    ).not.toThrow();
  });
});
