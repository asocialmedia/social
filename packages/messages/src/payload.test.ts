import { describe, expect, test } from "bun:test";

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
});
