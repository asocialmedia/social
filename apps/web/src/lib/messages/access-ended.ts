// What the app says to somebody who has just been removed from a den.
//
// Two surfaces report it, and they used to be three. A toast fired the moment the
// server closed the stream, a line sat directly above the composer, and the
// composer itself said nothing about why its input was dead. The toast and the
// line are both gone: one announcement, once, as a dialog.
//
// The input is the survivor, and it carries the durable half - the composer's
// placeholder in `composer-copy.ts` explains why it cannot be typed into, and stays
// on screen for as long as the reader is out. This file owns the announcement and
// the self-leave counterpart.
//
// It is also the only place the wording can be pinned at all. The composer and the
// thread are both entangled with the session, the identity key, the message stream
// and a 6,000-line component, so neither renders in a test without standing all of
// that up first. The copy is pure, and so is assertable on its own.

// The one sentence. It is the removal dialog's title AND the self-leave dialog's,
// which is the point of sharing it: both describe the same fact, so a reader who
// sees one and then the other cannot be told two different things happened.
export const ACCESS_ENDED_MESSAGE =
  "Looks like you've lost your spot in this den";

// The dialog body, and the fact that decides what somebody does next - which is
// nothing at all. The short title does not carry it, and the composer's placeholder
// cannot afford the sentence.
export const ACCESS_ENDED_DESCRIPTION =
  "You can still read this conversation, but you can't post in it.";

// The acknowledgement, not an action. Pressing it puts the dialog away and
// nothing else happens: there is no den to leave (the reader is already out of
// it), nothing to delete, and nowhere to navigate to. The emoticon is the
// product's wording and stays in.
export const ACCESS_ENDED_DISMISS_LABEL = "Fair enough :(";

// Whether this reader has lost the ability to act in the conversation.
//
// A boolean and not the object this used to return. The dismissed flag went with
// the inline notice it belonged to: a dialog is dismissed by closing it, which is
// state the Dialog primitive already owns, and keeping a second copy of "have they
// seen it" here was the reason the notice could outlive the removal it was given
// for.
export interface AccessEndedState {
  accessEnded: boolean;
}

// A fresh object on every call rather than a shared constant, because a
// conversation switch resets BY SETTING this. A module-level constant would be
// the same reference every time, and React bails out of a render whose state is
// `Object.is`-equal to the old one, so the reset would silently do nothing.
export function accessEndedOnArrival(): AccessEndedState {
  return { accessEnded: false };
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
