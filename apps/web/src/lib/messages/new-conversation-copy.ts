// What a refused attempt to open a conversation says.
//
// Two surfaces open one: the conversation list's search results and the friends
// rail's "new message" event, both through `startConversation`. The refusal used to
// be the server's error string printed verbatim, which meant the most common
// possible failure reached the reader as:
//
//   Can't message
//   Unauthorized
//
// That is the route's internal shape, not an answer. A 401 here means this device
// has no session, which is one of two very different things and the reader can
// only tell them apart if they are told: the session may have expired and a
// sign-in fixes it, or the tab raced its own sign-in and a retry costs nothing.
//
import { MessagesApiError } from "./client";

// So the mapping lives here, in one place, and the server's own sentence is used
// only for the refusals that were WRITTEN for a human - the follow gate, the
// block, the missing identity - which is what it was written for. Pure, so each
// mapping is asserted rather than eyeballed; the toast that shows it is entangled
// with the session and the list query.

// The one failure that is about this device rather than about the other person.
// Actionable because there is exactly one thing to do about it.
const SESSION_DESCRIPTION =
  "Your session may have expired. Sign in again to start a chat.";

// What a failure that reached no answer at all says. The reader cannot act on a
// network drop, so the copy does not ask them to.
const GENERIC_DESCRIPTION = "Couldn't start chat";

export interface NewConversationErrorToast {
  description: string;
  title: string;
  variant: "destructive";
}

// The strings a route can answer with that are a shape rather than a sentence.
// Matched exactly, because these are literal response bodies rather than copy
// anybody would phrase differently; anything else the server sent is shown,
// because every other refusal on this route was written for a human to read.
const RESERVED_SERVER_STRINGS = new Set([
  "Bad Request",
  "Conflict",
  "Forbidden",
  "Internal Server Error",
  "Not Found",
  "Request failed",
  "Too Many Requests",
  "Unauthorized",
]);

// The toast for a refused create-or-find, from whatever the client threw.
//
// `error` is `unknown` on purpose: the call site is a catch block, and narrowing
// there would put the rule in a component instead of in the file that owns it.
// `status` is read structurally so a `MessagesApiError` and anything else carrying
// the field are both understood, and an error with no status at all - a thrown
// `TypeError` from a fetch that never got an answer - takes the generic branch.
export function newConversationErrorToast(
  error: unknown
): NewConversationErrorToast {
  const status = readStatus(error);
  const description =
    serverSentence(error) ??
    (status === 401 ? SESSION_DESCRIPTION : GENERIC_DESCRIPTION);
  return { description, title: "Can't message", variant: "destructive" };
}

function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const { status } = error as { status?: unknown };
  return typeof status === "number" ? status : null;
}

// The server's sentence, when it wrote one that is an answer rather than a shape.
//
// `MessagesApiError` and nothing else. Its `message` IS the response body's `error`
// field, verbatim, so it is exactly what the route chose to say - but the same
// accessor on a bare `Error` would hand the reader whatever the browser or the
// network happened to call it, and "Failed to fetch" is not an answer either.
//
// The reserved strings are the other exception: they are the generic bodies a
// helper falls back to when a route forgot to write one, and printing them tells
// the reader nothing they did not already know.
function serverSentence(error: unknown): string | null {
  if (!(error instanceof MessagesApiError)) {
    return null;
  }
  const trimmed = error.message.trim();
  if (trimmed.length === 0 || RESERVED_SERVER_STRINGS.has(trimmed)) {
    return null;
  }
  // A body that merely repeats the status, as `readErrorBody`'s own default does
  // when the JSON could not be parsed, is a shape too.
  if (/^Request failed \(\d+\)$/u.test(trimmed)) {
    return null;
  }
  return trimmed;
}
