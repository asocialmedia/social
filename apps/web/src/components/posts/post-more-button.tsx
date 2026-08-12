import type { PostData, UserData } from "@asm/db";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { Hash, MoreHorizontal, Trash2 } from "lucide-react";
import type * as React from "react";
import { useCallback, useState } from "react";
import { PostMetaEditorDialog } from "@/components/tags/post-meta-editor-dialog";
import { cn } from "@/lib/utils";
import DeletePostDialog from "./delete-post-dialog";

interface PostMoreButtonProps {
  className?: string;
  post: PostData;
}

export default function PostMoreButton({
  post,
  className,
}: PostMoreButtonProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
  }, []);

  const handleShowDeleteDialog = useCallback(() => {
    setShowDeleteDialog(true);
  }, []);

  const handleCloseDeleteDialog = useCallback(() => {
    setShowDeleteDialog(false);
  }, []);

  const handleShowEditDialog = useCallback(() => {
    setShowEditDialog(true);
  }, []);

  const handleCloseEditDialog = useCallback(() => {
    setShowEditDialog(false);
  }, []);

  const handleTriggerClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
    },
    []
  );

  return (
    <>
      <DropdownMenu onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Post options"
            className={cn(
              "pill-3d-hover group inline-flex h-8 w-8 items-center justify-center rounded-full border-0 p-0 text-muted-foreground active:translate-y-px",
              className,
              isOpen ? "opacity-100" : undefined
            )}
            onClick={handleTriggerClick}
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
            onClick={handleShowEditDialog}
          >
            <span className="flex items-center gap-3">
              <Hash className="size-4" />
              Edit tags &amp; mentions
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="pill-3d-hover rounded-md px-2 py-2"
            onClick={handleShowDeleteDialog}
          >
            <span className="flex items-center gap-3 text-destructive">
              <Trash2 className="size-4" />
              Delete
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeletePostDialog
        onClose={handleCloseDeleteDialog}
        open={showDeleteDialog}
        post={post}
      />

      <PostMetaEditorDialog
        mentions={(post.mentions ?? []).map(
          (m) => m.user as unknown as UserData
        )}
        onClose={handleCloseEditDialog}
        open={showEditDialog}
        postId={post.id}
        tags={post.tags ?? []}
      />
    </>
  );
}
