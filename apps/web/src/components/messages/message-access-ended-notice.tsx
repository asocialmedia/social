"use client";

import { Button } from "@asm/ui/shadui/button";

import {
  ACCESS_ENDED_DISMISS_LABEL,
  ACCESS_ENDED_MESSAGE,
} from "@/lib/messages/access-ended";

// The composer's notice for a member the server has removed from the den.
//
// The message sits in an `<output>` and the button sits BESIDE it, not inside
// it. `<output>` is an implicit polite live region, and a control nested inside
// a live region is announced as part of the region rather than as itself on more
// than one screen reader, so what the reader hears would depend on which one
// they use. A plain wrapper with the live region holding only the words keeps
// both halves honest: the news is announced once, and the button is announced as
// the button it is.
//
// Its own text is its accessible name, so there is deliberately no `aria-label`
// to drift away from what is on screen. `type="button"` because the composer is
// not inside a form today, and a control that quietly becomes a submit button the
// day somebody wraps this in one would post a message nobody wrote.
//
// The ghost variant because this is the quietest register in the composer: a
// reader who has already lost their spot does not need a second loud thing next
// to the news, and the 3D recipe still comes from the primitive.
export function MessageAccessEndedNotice({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <output className="text-muted-foreground block text-xs">
        {ACCESS_ENDED_MESSAGE}
      </output>
      <Button
        className="text-muted-foreground shrink-0"
        onClick={onDismiss}
        size="sm"
        type="button"
        variant="ghost"
      >
        {ACCESS_ENDED_DISMISS_LABEL}
      </Button>
    </div>
  );
}
