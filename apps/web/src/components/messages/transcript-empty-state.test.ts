import { describe, expect, test } from "bun:test";

import { transcriptIsEmpty } from "./message-thread";

// The reported bug: a den created with a picture showed "Say hi in <name>" and
// nothing else, and the creation line the server had already written was
// invisible.
//
// The empty state was keyed off the message list. A den's first act is a
// membership log line, and it arrives before the first message, so every new den
// opened on its own empty state with the one line that explains what the room is
// hidden underneath it.
describe("transcriptIsEmpty", () => {
  const createdEvent = {
    event: {
      action: "CREATED",
      actorId: "alice",
      actorName: "Alice",
      conversationId: "den-1",
      createdAt: new Date("2026-10-03T06:04:12.000Z"),
      id: "evt-1",
      targetName: null,
      targetUserId: null,
    },
    id: "event-1",
    kind: "event",
  } as const;

  test("a den with only its creation line is not empty", () => {
    // The regression itself: zero messages, one membership line, and the line is
    // the only thing there is to read.
    expect(transcriptIsEmpty([createdEvent])).toBe(false);
  });

  test("no messages and no lines really is empty", () => {
    expect(transcriptIsEmpty([])).toBe(true);
  });

  test("a single message is enough to fill the transcript", () => {
    expect(
      transcriptIsEmpty([
        {
          id: "m1",
          kind: "message",
          message: {
            createdAt: new Date("2026-10-03T06:05:00.000Z"),
            id: "m1",
          },
        } as never,
      ])
    ).toBe(false);
  });
});
