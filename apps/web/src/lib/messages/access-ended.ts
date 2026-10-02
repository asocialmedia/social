// What the app says to somebody who has just been removed from a den.
//
// Two surfaces report it: a toast the moment the server closes the message
// stream, and a persistent line in the composer. They used to word it
// differently, which meant a reader who saw the toast and then looked down at
// the composer was told two different things had happened. They are one
// sentence, so both read it from here.
//
// This is also the only place the wording can be pinned at all. The composer and
// the thread are both entangled with the session, the identity key, the message
// stream and a 5,000-line component, so neither renders in a test without
// standing all of that up first. The copy and the one rule that decides whether
// the notice is on screen are pure, and so are assertable on their own.

// The one sentence. It is the composer's notice AND the toast's title, which is
// the point of sharing it: the toast is what announced the news and the notice
// is what keeps saying it, so a reader who sees both has to read them as the
// same event.
export const ACCESS_ENDED_MESSAGE =
  "Looks like you've lost your spot in this den";

// Toast-only, and kept deliberately. "You can still read this" is the fact that
// decides what somebody does next, which is nothing at all, and the short line
// above does not carry it — so the toast says it and the notice does not.
export const ACCESS_ENDED_DESCRIPTION =
  "You can still read this conversation, but you can't post in it.";

// The acknowledgement, not an action. Pressing it puts the notice away and
// nothing else happens: there is no den to leave (the reader is already out of
// it), nothing to delete, and nowhere to navigate to. The emoticon is the
// product's wording and stays in.
export const ACCESS_ENDED_DISMISS_LABEL = "Fair enough :(";

// The notice's whole state, as one value because it has one lifetime. Both flags
// describe THIS visit to THIS conversation, so they are cleared together and a
// dismissal can never outlive the removal it was given for.
export interface AccessEndedNoticeState {
  accessEnded: boolean;
  noticeDismissed: boolean;
}

// A fresh object on every call rather than a shared constant, because a
// conversation switch resets BY SETTING this. A module-level constant would be
// the same reference every time, and React bails out of a render whose state is
// `Object.is`-equal to the old one, so the reset would silently do nothing.
export function accessEndedOnArrival(): AccessEndedNoticeState {
  return { accessEnded: false, noticeDismissed: false };
}

// Whether the composer draws the notice.
//
// The asymmetry is the whole gate: only `accessEnded` can raise the notice and
// only `noticeDismissed` can lower it. So a dismissal cannot put anybody back
// into a den, and a member who was never removed has nothing to dismiss.
export function shouldShowAccessEndedNotice(
  state: AccessEndedNoticeState
): boolean {
  return state.accessEnded && !state.noticeDismissed;
}

// Conversations the reader left by their own action, in this tab's memory.
//
// Leaving your own den and being removed from one both end your access the same
// way on the wire: the server closes the stream with a `membership-ended` frame.
// The two need different feedback - leaving is something you did and deserve a
// dialog for, being removed is something that happened to you and deserves the
// notice the removal toast carries - so the leave action drops a marker here, and
// the stream handler consumes it to tell the cases apart.
//
// In memory and not persistent, and single-use. A marker that survived a reload
// would silence a real removal notice, and a marker that was not consumed would
// suppress the next genuine one; `forgetSelfLeave` also clears it when the leave
// request fails, because a failed leave must not suppress anything later.
const selfLeftConversations = new Set<string>();

export function noteSelfLeave(conversationId: string): void {
  selfLeftConversations.add(conversationId);
}

export function forgetSelfLeave(conversationId: string): void {
  selfLeftConversations.delete(conversationId);
}

export function consumeSelfLeave(conversationId: string): boolean {
  return selfLeftConversations.delete(conversationId);
}

// What the centered dialog says after a self-leave. The same first sentence as
// the notice, because it is the same fact; the body is different because the
// departure was chosen, and the useful thing to say is that the den is not gone.
export const SELF_LEAVE_DESCRIPTION =
  "It's still in your messages, and everything said before you left is still there to read. You can't post in it, and you can rejoin with an invite link.";

// The toast. The same headline as the notice plus the one fact the notice leaves
// out, and deliberately no button: a toast is gone in seconds, so an action on
// it would offer something the reader could no longer reach by the time they
// found it. The acknowledgement lives on the notice, which stays.
export function accessEndedToast(): { description: string; title: string } {
  return {
    description: ACCESS_ENDED_DESCRIPTION,
    title: ACCESS_ENDED_MESSAGE,
  };
}
