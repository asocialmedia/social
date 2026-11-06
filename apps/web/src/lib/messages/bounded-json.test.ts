import { expect, test } from "bun:test";

import { LIFECYCLE_CAPABILITY } from "@asm/messages";

import { parseBoundedJsonBody } from "./bounded-json";
import { chatCapabilityError } from "./chat-capability";

test("chunked bodies stop before an oversized stream can be retained", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    pull(controller) {
      controller.enqueue(new Uint8Array(64));
    },
  });
  await expect(
    parseBoundedJsonBody(
      new Request("https://example.test", { body, method: "POST" }),
      100
    )
  ).rejects.toThrow("BODY_TOO_LARGE");
  expect(cancelled).toBe(true);
  expect(
    await parseBoundedJsonBody(
      new Request("https://example.test", { body: "{", method: "POST" })
    )
  ).toBeNull();
});

test("timed history requires capability acknowledgement on reads and streams", () => {
  expect(
    chatCapabilityError(new Request("https://example.test"), {
      retentionVersion: 1,
    })?.status
  ).toBe(426);
  expect(
    chatCapabilityError(
      new Request(`https://example.test?capability=${LIFECYCLE_CAPABILITY}`),
      { retentionVersion: 1 }
    )
  ).toBeNull();
  expect(
    chatCapabilityError(new Request("https://example.test"), {
      retentionVersion: 0,
    })
  ).toBeNull();
});
