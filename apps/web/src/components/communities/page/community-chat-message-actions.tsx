"use client";

import { QUICK_MESSAGE_REACTIONS } from "@asm/messages";
import { Button } from "@asm/ui/shadui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@asm/ui/shadui/popover";
import {
  Link2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  Reply,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { useState } from "react";

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
  const [reactionsOpen, setReactionsOpen] = useState(false);
  return (
    <fieldset
      aria-label="Message actions"
      className="panel-3d absolute top-0 right-1 z-10 flex items-center rounded-full! p-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
    >
      {props.canSend ? (
        <Popover onOpenChange={setReactionsOpen} open={reactionsOpen}>
          <PopoverTrigger asChild>
            <Button
              aria-label="Add reaction"
              className="size-8 rounded-full"
              size="icon"
              variant="ghost"
            >
              <SmilePlus className="size-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-1.5">
            <p className="sr-only">Choose a reaction</p>
            <div className="flex gap-0.5">
              {QUICK_MESSAGE_REACTIONS.map((emoji) => (
                <Button
                  aria-label={`React ${emoji}`}
                  className="size-10 text-xl"
                  key={emoji}
                  onClick={() => {
                    props.onReact(emoji);
                    setReactionsOpen(false);
                  }}
                  size="icon"
                  variant="ghost"
                >
                  {emoji}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="More message actions"
            className="size-8 rounded-full"
            size="icon"
            variant="ghost"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {props.canSend ? (
            <DropdownMenuItem onSelect={props.onReply}>
              <Reply className="mr-2 size-4" />
              Reply
            </DropdownMenuItem>
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
    </fieldset>
  );
}
