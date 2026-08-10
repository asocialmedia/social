import type { CommentData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import DeleteCommentDialog from "./delete-comment-dialog";

interface CommentMoreButtonProps {
  className?: string;
  comment: CommentData;
}

export default function CommentMoreButton({
  comment,
  className,
}: CommentMoreButtonProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDeleteClick = useCallback(() => {
    setShowDeleteDialog(true);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setShowDeleteDialog(false);
  }, []);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className={className} size="icon" variant="ghost">
            <MoreHorizontal className="size-5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handleDeleteClick}>
            <span className="flex items-center gap-3 text-destructive">
              <Trash2 className="size-4" />
              Delete
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteCommentDialog
        comment={comment}
        onClose={handleCloseDialog}
        open={showDeleteDialog}
      />
    </>
  );
}
