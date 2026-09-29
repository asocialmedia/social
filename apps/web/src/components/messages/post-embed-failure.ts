// Why a post card failed, and what it may honestly say about it.
//
// The distinction this exists for: "this post is gone" and "I could not load this
// post" are different facts, and the card used to claim the first for both. A 404
// is the server saying the post is deleted or is in a private community the viewer
// cannot read, which is the one case where "no longer available" is accurate. A 401
// (an expired session), a 429, a 500, a dropped connection and a malformed body are
// all "not right now", and telling the user their post vanished is a lie that also
// has nowhere to undo itself: the failure is cached, so the notice is pinned for the
// life of the query.
//
// A post shared in a message is the one card a reader cannot get elsewhere. The
// wrong copy is not a cosmetic error there.

// Gone means the server answered, and the answer was "not for you". Retryable means
// the card does not know, and the safe direction for an unknown is never to declare
// absence -- the only way to be wrong that way is permanently.
export type PostEmbedFailure = "gone" | "retryable";

export function postEmbedFailure(status: number | undefined): PostEmbedFailure {
  // `undefined` is a request that never produced a response at all, so it cannot
  // be evidence of anything.
  return status === 404 ? "gone" : "retryable";
}

// A 404 is not worth a second request: the server has answered, and asking again
// costs the reader a request to be told the same thing. Everything else gets
// exactly one retry -- enough to ride out a blip or an expired session, bounded so
// a genuinely broken endpoint cannot turn one card into a request loop. A failing
// card inside a virtualized list has to be cheap, and a list of twenty of them
// multiplies whatever this returns.
export function postEmbedRetries(
  failureCount: number,
  status: number | undefined
): boolean {
  return postEmbedFailure(status) === "retryable" && failureCount < 1;
}
