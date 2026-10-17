"use client";

import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@asm/ui/shadui/dialog";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { useChatLifecycle } from "./chat-lifecycle-state";

export function EndIncognitoButton() {
  const { snapshot, mutate, busy, error, dismiss } = useChatLifecycle();
  const [open, setOpen] = useState(false);
  const session = snapshot?.activeSession;
  if (!session || session.endedAt) {
    return null;
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          dismiss();
          setOpen(next);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 rounded-full px-3 text-xs"
          disabled={busy}
          onClick={dismiss}
        >
          End chat
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>End incognito for both of you?</DialogTitle>
          <DialogDescription>
            All messages and attachments in this session will be deleted,
            including unread messages.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Keep chatting
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              const ended = await mutate({
                action: "end-incognito",
                sessionId: session.id,
              });
              if (ended) {
                setOpen(false);
              }
            }}
          >
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}End
            and delete messages
          </Button>
        </DialogFooter>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
