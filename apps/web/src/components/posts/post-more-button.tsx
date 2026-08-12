import type { PostData } from "@asm/db";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
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

  return (
    <>
      <DropdownMenu onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Post options"
            className={cn(
              "group inline-flex h-8 w-8 items-center justify-center rounded-full border-0 p-0 text-muted-foreground outline-none transition-all duration-200 ease-out hover:bg-gradient-to-b hover:from-[#8f96a3] hover:to-[#5c6370] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] active:translate-y-px",
              className,
              isOpen ? "opacity-100" : undefined
            )}
            type="button"
          >
            <MoreHorizontal className="size-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleShowDeleteDialog}>
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
    </>
  );
}
