import type { PostData, TagWithCount, UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Dialog, DialogContent, DialogTitle } from "@asm/ui/shadui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { AtSign, MoreHorizontal, Tags, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { MentionTags } from "@/components/tags/mention-tags";
import { Tags as TagsComponent } from "@/components/tags/tags";
import DeletePostDialog from "./delete-post-dialog";

interface PostMoreButtonProps {
  className?: string;
  onUpdate?: (updatedPost: PostData) => void;
  post: PostData;
}

export default function PostMoreButton({
  post,
  className,
  onUpdate,
}: PostMoreButtonProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showMentionsDialog, setShowMentionsDialog] = useState(false);
  const [showTagsDialog, setShowTagsDialog] = useState(false);

  const mentions = useMemo(
    () => post.mentions?.map((m) => m.user) || [],
    [post.mentions]
  );

  const handleMentionsUpdate = useCallback(
    (newMentions: UserData[]) => {
      if (JSON.stringify(mentions) !== JSON.stringify(newMentions)) {
        const updatedPost: PostData = {
          ...post,
          mentions: newMentions.map((user) => ({
            id: `${post.id}-${user.id}`,
            postId: post.id,
            userId: user.id,
            user,
            createdAt: new Date(),
          })),
        };
        onUpdate?.(updatedPost);
        setShowMentionsDialog(false);
      }
    },
    [post, onUpdate, mentions]
  );

  const handleTagsUpdate = useCallback(
    (newTags: TagWithCount[]) => {
      if (JSON.stringify(post.tags) !== JSON.stringify(newTags)) {
        const updatedPost: PostData = {
          ...post,
          tags: newTags,
        };
        onUpdate?.(updatedPost);
        setShowTagsDialog(false);
      }
    },
    [post, onUpdate]
  );

  const handleShowMentionsDialog = useCallback(() => {
    setShowMentionsDialog(true);
  }, []);

  const handleShowTagsDialog = useCallback(() => {
    setShowTagsDialog(true);
  }, []);

  const handleShowDeleteDialog = useCallback(() => {
    setShowDeleteDialog(true);
  }, []);

  const handleCloseDeleteDialog = useCallback(() => {
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
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleShowMentionsDialog}>
            <span className="flex items-center gap-3 text-foreground">
              <AtSign className="size-4" />
              Edit Mentions
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleShowTagsDialog}>
            <span className="flex items-center gap-3 text-foreground">
              <Tags className="size-4" />
              Edit Tags
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleShowDeleteDialog}>
            <span className="flex items-center gap-3 text-destructive">
              <Trash2 className="size-4" />
              Delete
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog onOpenChange={setShowMentionsDialog} open={showMentionsDialog}>
        <DialogContent>
          <DialogTitle>Edit Mentions</DialogTitle>
          <MentionTags
            isOwner={true}
            // biome-ignore lint/suspicious/noExplicitAny: ignore
            mentions={mentions as any}
            onMentionsChange={handleMentionsUpdate}
            postId={post.id}
          />
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setShowTagsDialog} open={showTagsDialog}>
        <DialogContent>
          <DialogTitle>Edit Tags</DialogTitle>
          <TagsComponent
            isOwner={true}
            onTagsChange={handleTagsUpdate}
            postId={post.id}
            tags={post.tags}
          />
        </DialogContent>
      </Dialog>

      <DeletePostDialog
        onClose={handleCloseDeleteDialog}
        open={showDeleteDialog}
        post={post}
      />
    </>
  );
}
