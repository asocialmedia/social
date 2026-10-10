import { describe, expect, test } from "bun:test";

import type { MessageData, MessagePage } from "@/lib/messages/types";

import { createBoundedMessagePageResponse } from "./history-page";

function message(id: string, ciphertextLength = 300): MessageData {
  return {
    ciphertext: "x".repeat(ciphertextLength),
    conversationId: "conversation-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    editedAt: null,
    id,
    iv: "iv",
    ratchetIndex: 0,
    senderId: "user-1",
  };
}

function page(messages: MessageData[], anchorIndex?: number): MessagePage {
  return {
    ...(anchorIndex === undefined ? {} : { anchorIndex }),
    messages,
    nextCursor: null,
    previousCursor: null,
  };
}

async function read(response: Response): Promise<MessagePage> {
  expect(response.status).toBe(200);
  return (await response.json()) as MessagePage;
}

describe("createBoundedMessagePageResponse", () => {
  test("keeps the newest rows and returns an older continuation after byte trimming", async () => {
    const response = createBoundedMessagePageResponse(
      page([message("old"), message("middle"), message("new")]),
      "older",
      1100
    );
    const result = await read(response);

    expect(result.messages.map(({ id }) => id)).toEqual(["middle", "new"]);
    expect(result.previousCursor).toBe("middle");
    expect(
      new TextEncoder().encode(JSON.stringify(result)).byteLength
    ).toBeLessThanOrEqual(1100);
  });

  test("keeps the oldest rows and returns a newer continuation after byte trimming", async () => {
    const response = createBoundedMessagePageResponse(
      page([message("old"), message("middle"), message("new")]),
      "newer",
      1100
    );
    const result = await read(response);

    expect(result.messages.map(({ id }) => id)).toEqual(["old", "middle"]);
    expect(result.nextCursor).toBe("middle");
  });

  test("trims the side farther from an around anchor and adjusts both cursors", async () => {
    const response = createBoundedMessagePageResponse(
      page(
        [
          message("old"),
          message("left"),
          message("anchor"),
          message("right"),
          message("new"),
        ],
        2
      ),
      "around",
      1500
    );
    const result = await read(response);

    expect(result.messages.some(({ id }) => id === "anchor")).toBe(true);
    expect(result.anchorIndex).toBe(
      result.messages.findIndex(({ id }) => id === "anchor")
    );
    expect(result.previousCursor).toBe(result.messages[0]?.id);
    expect(result.nextCursor).toBe(result.messages.at(-1)?.id);
  });

  test("does not exceed the serialized byte budget", async () => {
    const response = createBoundedMessagePageResponse(
      page(
        Array.from({ length: 20 }, (_, index) => message(`m-${index}`, 2000))
      ),
      "older",
      5000
    );
    const body = await response.text();

    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(5000);
    expect(JSON.parse(body).messages.length).toBeGreaterThan(0);
  });
});
