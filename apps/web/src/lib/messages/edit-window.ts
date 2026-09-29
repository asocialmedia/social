// Message-edit policy shared by the server route and the client UI. Client-safe
// (no server imports) so the bubble can gate its Edit action on the exact same
// window the API enforces, without pulling the Prisma-backed server module into
// the browser bundle.

// How long after sending a message may its sender still rewrite it. The server
// always measures this from the stored `createdAt` (never a client clock), so a
// stale or tampered client cannot edit history indefinitely; the client uses
// the same value only to hide an action that would be rejected anyway.
export const MESSAGE_EDIT_WINDOW_MS = 12 * 60 * 60 * 1000;

// Upper bound on a rewritten ciphertext. Generous (a full album payload is a
// few KB) but bounded, so an authenticated sender cannot use edits to bloat a
// row without limit. Only enforced on the edit path; the create path keeps its
// existing contract.
export const MAX_MESSAGE_CIPHERTEXT_LENGTH = 100_000;

// Whether a message is still inside its edit window. Accepts a serialized ISO
// string too: rows arrive as JSON on the wire, so createdAt/editedAt are
// strings until the stream's date revival runs. `now` is injectable so the
// boundary is unit-testable without freezing the clock.
export function isWithinEditWindow(
  createdAt: Date | string,
  now: Date = new Date()
): boolean {
  const created =
    typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(created.getTime())) {
    // An unparseable timestamp fails closed: never offer an edit the server
    // would reject, and never treat garbage as "just sent".
    return false;
  }
  return now.getTime() - created.getTime() <= MESSAGE_EDIT_WINDOW_MS;
}
