"use client";

import { QUICK_MESSAGE_REACTIONS } from "@asm/messages";
import { Button } from "@asm/ui/shadui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import {
  Link2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  Reply,
  Trash2,
} from "lucide-react";
import { useRef } from "react";

interface MessageActionsProps {
  canManage: boolean;
  canSend: boolean;
  isOwn: boolean;
  onCopyLink: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onPin: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onStartThread?: () => void;
  pinned: boolean;
}

export default function CommunityChatMessageActions(
  props: MessageActionsProps
) {
  const replyAfterClose = useRef(false);
  return (
    <div className="absolute top-0 right-0 z-10">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="More message actions"
            className="text-muted-foreground/60 hover:text-foreground size-11 rounded-full sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
            size="icon"
            variant="ghost"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-52"
          onCloseAutoFocus={(event) => {
            if (replyAfterClose.current) {
              event.preventDefault();
              replyAfterClose.current = false;
              props.onReply();
            }
          }}
        >
          {props.canSend ? (
            <>
              <DropdownMenuGroup
                aria-label="React to message"
                className="m-0 flex min-w-0 items-center gap-0.5 border-0 p-1"
              >
                {QUICK_MESSAGE_REACTIONS.map((emoji) => (
                  <DropdownMenuItem
                    aria-label={`React ${emoji}`}
                    className="size-11 justify-center rounded-xl p-0 text-xl"
                    key={emoji}
                    onSelect={() => props.onReact(emoji)}
                  >
                    {emoji}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  replyAfterClose.current = true;
                }}
              >
                <Reply className="mr-2 size-4" />
                Reply
              </DropdownMenuItem>
            </>
          ) : null}
          {props.canSend && props.onStartThread ? (
            <DropdownMenuItem onSelect={props.onStartThread}>
              <MessageCircle className="mr-2 size-4" />
              Start a thread
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={props.onCopyLink}>
            <Link2 className="mr-2 size-4" />
            Copy message link
          </DropdownMenuItem>
          {props.canManage ? (
            <DropdownMenuItem onSelect={props.onPin}>
              <Pin className="mr-2 size-4" />
              {props.pinned ? "Unpin message" : "Pin message"}
            </DropdownMenuItem>
          ) : null}
          {props.isOwn && props.canSend ? (
            <DropdownMenuItem onSelect={props.onEdit}>
              <Pencil className="mr-2 size-4" />
              Edit message
            </DropdownMenuItem>
          ) : null}
          {props.isOwn || props.canManage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onSelect={props.onDelete}
              >
                <Trash2 className="mr-2 size-4" />
                Delete message
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
