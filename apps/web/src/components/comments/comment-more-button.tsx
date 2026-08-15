import type { CommentData } from "@asm/db";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

import { setPopupOpen } from "@/lib/popup-tracker";
import { cn } from "@/lib/utils";

import DeleteCommentDialog from "./delete-comment-dialog";

interface CommentMoreButtonProps {
  applyDeleted: (comment: CommentData) => void;
  className?: string;
  comment: CommentData;
}

export default function CommentMoreButton({
  applyDeleted,
  comment,
  className,
}: CommentMoreButtonProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    setPopupOpen(open);
  }, []);

  const handleDeleteClick = useCallback(() => {
    setShowDeleteDialog(true);
    setPopupOpen(true);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setShowDeleteDialog(false);
    setPopupOpen(false);
  }, []);

  return (
    <>
      <DropdownMenu onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Comment options"
            className={cn(
              "pill-3d-hover group text-muted-foreground inline-flex h-8 w-8 items-center justify-center rounded-full border-0 p-0 active:translate-y-px",
              className,
              isOpen ? "opacity-100" : undefined
            )}
            type="button"
          >
            <MoreHorizontal className="size-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="apple-panel p-1.5 shadow-none"
        >
          <DropdownMenuItem
            className="pill-3d-hover rounded-md px-2 py-2"
            onClick={handleDeleteClick}
          >
            <span className="text-destructive flex items-center gap-3">
              <Trash2 className="size-4" />
              Delete
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteCommentDialog
        applyDeleted={applyDeleted}
        comment={comment}
        onClose={handleCloseDialog}
        open={showDeleteDialog}
      />
    </>
  );
}
