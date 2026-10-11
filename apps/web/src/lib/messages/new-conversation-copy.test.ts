import { describe, expect, test } from "bun:test";

import { MessagesApiError } from "./client";
import { newConversationErrorToast } from "./new-conversation-copy";

// The shape of the failure this file exists for. A 401 from the conversations
// route carries the response body's `error` field verbatim, which is the bare word
// "Unauthorized" - a status the route happens to answer with, not an answer.
function unauthorized() {
  return new MessagesApiError("Unauthorized", 401);
}

describe("newConversationErrorToast", () => {
  // The regression. `startConversation` printed `error.message`, so the most likely
  // failure of all reached the reader as a description reading "Unauthorized".
  test("a 401 never reaches the reader as a bare status word", () => {
    const toast = newConversationErrorToast(unauthorized());
    expect(toast.description).not.toBe("Unauthorized");
    expect(toast.description).toContain("session");
  });

  test("a 401 is actionable, because a sign-in is the one thing that fixes it", () => {
    expect(newConversationErrorToast(unauthorized()).description).toBe(
      "Your session may have expired. Sign in again to start a chat."
    );
  });

  test("the title does not change with the failure", () => {
    // One title for every refusal, so the reader learns which action they were
    // refused rather than what went wrong underneath it.
    for (const error of [
      unauthorized(),
      new MessagesApiError("You can only message people you follow", 403),
      new MessagesApiError(
        "Enable Messages first to start a conversation",
        409
      ),
      new MessagesApiError("Too many messages, try again shortly", 429),
      new TypeError("Failed to fetch"),
      new Error("socket hang up"),
    ]) {
      expect(newConversationErrorToast(error).title).toBe("Can't message");
    }
  });

  // Every other refusal on this route was written for a human to read, so it is
  // shown exactly as the server phrased it.
  test("the follow gate keeps its own sentence", () => {
    expect(
      newConversationErrorToast(
        new MessagesApiError("You can only message people you follow", 403)
      ).description
    ).toBe("You can only message people you follow");
  });

  test("a block keeps its own sentence", () => {
    expect(
      newConversationErrorToast(
        new MessagesApiError("You cannot message this user", 403)
      ).description
    ).toBe("You cannot message this user");
  });

  test("a missing identity keeps its own sentence", () => {
    expect(
      newConversationErrorToast(
        new MessagesApiError("This user hasn't enabled Messages yet", 409)
      ).description
    ).toBe("This user hasn't enabled Messages yet");
  });

  test("a rate limit keeps its own sentence", () => {
    expect(
      newConversationErrorToast(
        new MessagesApiError("Too many messages, try again shortly", 429)
      ).description
    ).toBe("Too many messages, try again shortly");
  });

  // A generic body is what a helper falls back to when a route forgot to write one.
  // Printing it tells the reader nothing, so it is dropped for copy that says what
  // happened to them.
  test("a generic response body is never shown verbatim", () => {
    for (const body of [
      "Unauthorized",
      "Forbidden",
      "Bad Request",
      "Conflict",
      "Not Found",
      "Too Many Requests",
      "Internal Server Error",
    ]) {
      const toast = newConversationErrorToast(new MessagesApiError(body, 418));
      expect(toast.description).toBe("Couldn't start chat");
    }
  });

  // `readErrorBody`'s own default, when the body was not JSON at all.
  test("a status-only fallback string is never shown verbatim", () => {
    for (const body of ["Request failed (401)", "Request failed (500)"]) {
      expect(
        newConversationErrorToast(new MessagesApiError(body, 401)).description
      ).toBe("Your session may have expired. Sign in again to start a chat.");
    }
  });

  // A fetch that never got an answer. The reader cannot act on a dropped
  // connection, so the copy does not ask them to.
  test("a dropped request is not reported as a problem with the session", () => {
    expect(newConversationErrorToast(new TypeError("Failed to fetch"))).toEqual(
      {
        description: "Couldn't start chat",
        title: "Can't message",
        variant: "destructive",
      }
    );
  });

  // Only `MessagesApiError` carries a sentence the server chose to write. A bare
  // Error's message is the browser's or a library's, and "socket hang up" is not
  // something the reader can act on.
  test("an error with no status at all still says something", () => {
    expect(newConversationErrorToast(new Error("socket hang up"))).toEqual({
      description: "Couldn't start chat",
      title: "Can't message",
      variant: "destructive",
    });
  });

  test("a non-error throw does not crash the toast", () => {
    expect(newConversationErrorToast({ status: 401 }).description).toBe(
      "Your session may have expired. Sign in again to start a chat."
    );
    expect(newConversationErrorToast().description).toBe("Couldn't start chat");
    expect(newConversationErrorToast(null).description).toBe(
      "Couldn't start chat"
    );
    expect(newConversationErrorToast("Unauthorized").description).toBe(
      "Couldn't start chat"
    );
  });

  test("every refusal is destructive", () => {
    for (const error of [
      unauthorized(),
      new MessagesApiError("You can only message people you follow", 403),
      new TypeError("Failed to fetch"),
    ]) {
      expect(newConversationErrorToast(error).variant).toBe("destructive");
    }
  });
});
