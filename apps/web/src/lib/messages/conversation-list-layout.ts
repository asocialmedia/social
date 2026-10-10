// Which shape the conversation list takes, as a function of what is open and how
// wide the window is.
//
// The list is the one surface with two jobs. With nothing open it is the way IN:
// it has to say who each conversation is with and what was last said, which needs
// width. With a conversation open it is the way AROUND: the transcript and the
// details pane want the room, and a full-width list would leave the thread
// cramped to pay for names nobody is reading.
//
// Below `md` neither is affordable at once. A phone shows one pane at a time --
// the list, or the conversation -- and the thread's back button is what swaps
// them. That is why `hidden` exists rather than a narrow rail: a rail on a phone
// is 64px stolen from the transcript to duplicate a control the back button
// already is.
//
// Pure so the rule is testable apart from the media query and the router. See
// conversation-list-layout.test.ts.

export type ConversationListLayout = "full" | "hidden" | "rail";

export interface ConversationListLayoutInput {
  // Whether a conversation is open, which is the `?c=` param, not a local toggle:
  // a deep link into a thread and a click on a row land in the same state.
  conversationOpen: boolean;
  // True at Tailwind's `md` and up, matched with `48rem` so the CSS and this agree
  // on one number.
  desktopViewport: boolean;
  // Explicit user collapse preference for desktop viewports.
  collapsed?: boolean;
}

export function conversationListLayout({
  collapsed,
  conversationOpen,
  desktopViewport,
}: ConversationListLayoutInput): ConversationListLayout {
  // Below md (phone), only one pane shows at a time: the thread if open,
  // or the full list if nothing is open.
  if (!desktopViewport) {
    return conversationOpen ? "hidden" : "full";
  }

  // On desktop viewports, an explicit collapse choice takes precedence.
  if (collapsed !== undefined) {
    return collapsed ? "rail" : "full";
  }

  // Fallback when no collapse preference is specified:
  // With nothing open, the list is the surface. With a thread open, desktop
  // defaults to rail.
  if (!conversationOpen) {
    return "full";
  }
  return "rail";
}
