"use client";

import type { UserData } from "@asm/db";
import { MAX_POST_ATTACHMENTS } from "@asm/media";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { useHnShareStore } from "@asm/ui/store/hn-share-store";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "@tanstack/react-query";
import { Placeholder } from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Clapperboard,
  GripVertical,
  Hash,
  MoreHorizontal,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { useDropzone } from "react-dropzone";

import { useSession } from "@/app/(main)/session-provider";
import { LoadingButton } from "@/components/auth/loading-button";
import KlipyGifPicker from "@/components/comments/klipy-gif-picker";
import type { KlipyGif } from "@/components/comments/klipy-gif-picker";
import UserAvatar from "@/components/layouts/user-avatar";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

import "./styles.css";
import { useSubmitPostMutation } from "@/posts/editor/mutations";
import { useComposerStore } from "@/store/composer-store";

import AltTextPanel from "./alt-text-panel";
import { AttachmentPreview } from "./attachment-preview";
import { FileInput } from "./file-input";
import { HNStoryPreview } from "./hn-story-preview";
import { InlineSuggestions } from "./inline-suggestions";
import useMediaUpload from "./use-media-upload";
import type { Attachment } from "./use-media-upload";

export const GUST_CAPTION_MAX_WORDS = 150;
export const GUST_CAPTION_MAX_CHARS = 900;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.3,
      staggerChildren: 0.1,
    },
    y: 0,
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

/** Chip color for the n/10 counter: neutral, amber near the cap, red at it. */
function capacityChipClass(count: number, full: boolean): string {
  if (full) {
    return "bg-destructive/10 text-destructive";
  }
  if (count >= MAX_POST_ATTACHMENTS - 3) {
    return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  }
  return "bg-muted";
}

export default function PostEditor({
  variant = "feed",
}: {
  variant?: "feed" | "modal";
}) {
  const { user } = useSession();
  const router = useRouter();
  const mutation = useSubmitPostMutation();
  const hnShareStore = useHnShareStore();
  const sharedHnStory = hnShareStore.story;
  const isHnSharing = hnShareStore.isSharing;

  const composerMode = useComposerStore((state) => state.mode);
  const isGust = composerMode === "gust";

  const { data: userData } = useQuery({
    enabled: Boolean(user),
    queryFn: () => kyInstance.get(`/api/users/${user?.id}`).json<UserData>(),
    queryKey: ["user", user?.id],
    staleTime: 1000 * 60 * 5,
  });

  const {
    startUpload,
    attachments,
    cancelUpload,
    isUploading,
    removeAttachment,
    reorderAttachments,
    reset: resetMediaUploads,
    retryUpload,
    setAltText,
  } = useMediaUpload();

  // Shared contract with the server-side cap in submitPost.
  const capacityFull = attachments.length >= MAX_POST_ATTACHMENTS;
  // Two or more media items form a "group": mixed-mode options (GIFs, audio,
  // gust switching) lock because a group post is image/video-only, and the
  // lock holds after uploading finishes, not just during it. A single video
  // keeps the switcher live so it can still be published as a gust.
  const isGroupMedia = attachments.length > 1;
  // Any video makes the post video-only: GIFs and audio lock even for a
  // single clip, matching how published posts render mixed media.
  const hasVideoAttachment = attachments.some((a) =>
    (a.file?.type ?? a.type ?? "").startsWith("video/")
  );
  const mixedMediaLocked = isGroupMedia || hasVideoAttachment;
  const attachmentOptionsDisabled = isUploading || capacityFull;
  // Media-only posts are publishable: a completed attachment satisfies the
  // caption requirement (server schema enforces "text or attachment" too).
  const hasUploadError = attachments.some((a) => Boolean(a.error));
  const hasPublishableMedia =
    attachments.length > 0 &&
    attachments.every((a) => !a.isUploading && !a.error);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "image/*": isGust ? [] : [],
      "video/*": [],
    },
    maxSize: 128 * 1024 * 1024,
    noClick: true,
    noKeyboard: true,
    onDrop: async (acceptedFiles: File[]) => {
      const validFiles = acceptedFiles.filter((file: { type: string }) =>
        isGust
          ? file.type.startsWith("video/")
          : file.type.startsWith("image/") || file.type.startsWith("video/")
      );
      if (validFiles.length) {
        await startUpload(validFiles);
      }
    },
  });

  const rootProps = getRootProps();

  const { toast } = useToast();
  const [inputText, setInputText] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<UserData[]>([]);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const onSubmitRef = useRef<(() => void) | null>(null);

  const handleGifSelect = useCallback(
    async (gif: KlipyGif) => {
      setGifPickerOpen(false);
      try {
        const blob = await fetch(gif.url).then((r) => {
          if (!r.ok) {
            throw new Error("Failed to fetch GIF");
          }
          return r.blob();
        });
        const file = new File([blob], `${gif.slug || "gif"}.gif`, {
          type: "image/gif",
        });
        await startUpload([file]);
      } catch {
        toast({
          description: "Couldn't add that GIF, try another?",
          title: "GIF Failed",
          variant: "destructive",
        });
      }
    },
    [startUpload, toast]
  );

  const editor = useEditor({
    editorProps: {
      attributes: {
        class: "focus:outline-none",
      },
      handleDOMEvents: {
        keydown: (_view, event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmitRef.current?.();
            return true;
          }
          return false;
        },
      },
    },
    extensions: [
      StarterKit.configure({
        bold: false,
        italic: false,
      }),
      Placeholder.configure({
        placeholder: isGust
          ? "Add a caption for your gust..."
          : "What's crack-a-lackin'?",
      }),
    ],
    immediatelyRender: false,
    onUpdate: ({ editor: currentEditor }) => {
      setInputText(currentEditor.getText({ blockSeparator: "\n" }) || "");
    },
  });

  const input = inputText || editor?.getText({ blockSeparator: "\n" }) || "";
  const gustWordCount = countWords(input);
  const gustCaptionExceeded =
    isGust &&
    (gustWordCount > GUST_CAPTION_MAX_WORDS ||
      input.length > GUST_CAPTION_MAX_CHARS);
  // Show the counter once the caption reaches 80% of either limit (or is over).
  const gustCaptionNearLimit =
    isGust &&
    (gustWordCount >= GUST_CAPTION_MAX_WORDS * 0.8 ||
      input.length >= GUST_CAPTION_MAX_CHARS * 0.8);
  // A gust is not publishable until a video is attached (fresh blob or a
  // restored upload with a stored video type).
  const hasGustVideo = attachments.some((a) =>
    (a.file?.type ?? a.type ?? "").startsWith("video/")
  );

  const removeTag = useCallback((tagName: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tagName));
  }, []);

  const removeMention = useCallback((userId: string) => {
    setSelectedMentions((prev) => prev.filter((m) => m.id !== userId));
  }, []);

  const addMention = useCallback((mentionUser: UserData) => {
    setSelectedMentions((prev) =>
      prev.some((m) => m.id === mentionUser.id) ? prev : [...prev, mentionUser]
    );
  }, []);

  const addTag = useCallback((tagName: string) => {
    setSelectedTags((prev) =>
      prev.some((t) => t === tagName) ? prev : [...prev, tagName]
    );
  }, []);

  useEffect(() => {
    if (isHnSharing && editor) {
      editor.commands.focus();
      editor.commands.setContent(`Sharing: "${sharedHnStory?.title}"`);
      setTimeout(() => {
        editor.commands.selectAll();
      }, 100);
    }
  }, [isHnSharing, sharedHnStory, editor]);

  const onSubmit = useCallback(() => {
    const gustMediaIds = attachments
      .map((a) => a.mediaId)
      .filter((id): id is string => Boolean(id));

    if (hasUploadError) {
      toast({
        description: "Retry or remove failed uploads before posting",
        title: "Upload Incomplete",
        variant: "destructive",
      });
      return;
    }

    if (isGust && gustMediaIds.length === 0) {
      return;
    }

    // Caption OR attachment - media-only posts are valid fleets.
    if (!(input.trim() || isHnSharing || hasPublishableMedia)) {
      return;
    }

    const payload = {
      content: input.trim(),
      isGust,
      mediaIds: gustMediaIds,
      mentions: selectedMentions.map((mentionedUser) => mentionedUser.id),
      tags: selectedTags.map((tag) => tag.toLowerCase()),
      ...(isHnSharing && sharedHnStory
        ? {
            hnStory: {
              by: sharedHnStory.by,
              descendants: sharedHnStory.descendants,
              score: sharedHnStory.score,
              storyId: sharedHnStory.id,
              time: sharedHnStory.time,
              title: sharedHnStory.title,
              url: sharedHnStory.url,
            },
          }
        : {}),
    };

    if (!(payload.content || isHnSharing || payload.mediaIds.length > 0)) {
      return;
    }
    if (isGust && !hasGustVideo) {
      return;
    }
    if (isGust && gustCaptionExceeded) {
      return;
    }

    mutation.mutate(payload, {
      onSuccess: (newPost) => {
        editor?.commands.clearContent();
        setInputText("");
        resetMediaUploads();
        setSelectedTags([]);
        setSelectedMentions([]);
        setGifPickerOpen(false);
        if (isHnSharing) {
          hnShareStore.clearState();
        }
        // A gust is not a home-feed post; take the user to the reels feed
        // where their new clip is the active one.
        if (newPost?.isGust) {
          router.push(`/gusts?id=${newPost.id}`);
        }
      },
    });
  }, [
    input,
    attachments,
    hasPublishableMedia,
    hasUploadError,
    selectedTags,
    selectedMentions,
    mutation,
    editor,
    resetMediaUploads,
    isHnSharing,
    sharedHnStory,
    hnShareStore,
    isGust,
    gustCaptionExceeded,
    hasGustVideo,
    router,
    toast,
  ]);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  const handleRemoveHnStory = useCallback(() => {
    hnShareStore.clearState();
  }, [hnShareStore]);

  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      const files = [...e.clipboardData.items]
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile()) as File[];
      startUpload(files);
    },
    [startUpload]
  );

  // The composer is account-gated; guests see login CTAs instead.
  if (!user) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-5 p-5 shadow-none transition-shadow duration-300",
        variant === "feed"
          ? "border-border rounded-none border-t border-b bg-[hsl(var(--background-alt))]"
          : "rounded-none border-0 bg-transparent"
      )}
    >
      <div className="flex gap-5">
        <div className="mt-1 shrink-0">
          <motion.div
            transition={{ damping: 17, stiffness: 400, type: "spring" }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <UserAvatar
              avatarUrl={userData?.avatarUrl || user.image}
              className="h-10 w-10"
            />
          </motion.div>
        </div>
        <div className="w-full min-w-0">
          {/* Mobile-only mode switcher above the editor so the Post button stays on screen */}
          <div className="mb-3 flex md:hidden">
            <ModeToggle disabled={isGroupMedia} isGust={isGust} />
          </div>
          {(selectedTags.length > 0 || selectedMentions.length > 0) && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {selectedTags.map((tag) => (
                <RemoveChip
                  key={tag}
                  label={tag}
                  onRemove={removeTag}
                  removeLabel={`Remove tag ${tag}`}
                  value={tag}
                  variant="tag"
                />
              ))}
              {selectedMentions.map((mention) => (
                <RemoveChip
                  key={mention.id}
                  label={`@${mention.username}`}
                  onRemove={removeMention}
                  removeLabel={`Remove mention ${mention.username}`}
                  user={mention}
                  value={mention.id}
                  variant="mention"
                />
              ))}
            </div>
          )}

          <div {...rootProps}>
            <div
              className={cn(
                "relative rounded-2xl transition-all duration-300",
                isDragActive && "ring-primary ring-2 ring-offset-2"
              )}
            >
              {editor ? (
                <EditorContent
                  className={cn(
                    "premium-input text-foreground max-h-80 w-full max-w-full min-w-0 overflow-x-hidden overflow-y-auto px-5 py-3 break-words",
                    "transition-all duration-300 ease-in-out",
                    "focus-within:ring-primary focus-within:ring-2",
                    isDragActive && "outline-primary outline-dashed"
                  )}
                  editor={editor}
                  onPaste={onPaste}
                />
              ) : (
                <div
                  className={cn(
                    "premium-input text-foreground max-h-80 w-full max-w-full min-w-0 overflow-x-hidden overflow-y-auto px-5 py-3 break-words",
                    "transition-all duration-300 ease-in-out"
                  )}
                >
                  <div className="tiptap">
                    <p className="text-muted-foreground/70 select-none">
                      What&apos;s crack-a-lackin&apos;?
                    </p>
                  </div>
                </div>
              )}
              <InlineSuggestions
                editor={editor}
                onSelectMention={addMention}
                onSelectTag={addTag}
                selectedMentionIds={selectedMentions.map((m) => m.id)}
                selectedTagNames={selectedTags}
              />
              {isDragActive ? (
                <motion.div
                  animate={{ opacity: 1 }}
                  className="apple-panel border-primary/30 absolute inset-0 flex items-center justify-center rounded-2xl border-2 border-dashed bg-[hsl(var(--background-alt))]/90 backdrop-blur-sm"
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                >
                  <p className="text-primary text-lg font-medium">
                    Drop files here
                  </p>
                </motion.div>
              ) : null}
              {isHnSharing && sharedHnStory ? (
                <div className="mt-3">
                  <HNStoryPreview
                    onRemoveAction={handleRemoveHnStory}
                    story={sharedHnStory}
                  />
                </div>
              ) : null}
              {/* Hidden file input for drag & drop - positioned absolutely to avoid interfering with editor clicks */}
              <input
                {...getInputProps()}
                className="pointer-events-none absolute inset-0 opacity-0"
                style={{ height: 0, width: 0 }}
              />
            </div>
          </div>

          {/* Inline GIF picker */}
          <AnimatePresence>
            {isGust || !gifPickerOpen ? null : (
              <motion.div
                animate={{ height: "auto", opacity: 1 }}
                className="mt-3 overflow-hidden"
                exit={{ height: 0, opacity: 0 }}
                initial={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
              >
                <div className="reels-panel w-full rounded-2xl p-2.5">
                  <KlipyGifPicker
                    disabled={isUploading}
                    onSelect={handleGifSelect}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {isGust ? (
            <div className="mt-2 flex items-center justify-between text-xs">
              {hasGustVideo ? null : (
                <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                  Attach a video to publish a gust
                </span>
              )}
              {/* Counter appears only near/over the word or char limit */}
              {gustCaptionNearLimit ? (
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    gustCaptionExceeded
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  {gustWordCount}/{GUST_CAPTION_MAX_WORDS} words ·{" "}
                  {input.length}/{GUST_CAPTION_MAX_CHARS} chars
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {/* Mobile-only: inline image/video button; the rest collapse into
                  a dropdown. */}
              <div className="max-md:flex md:hidden">
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <FileInput
                    disabled={attachmentOptionsDisabled}
                    onFilesSelected={startUpload}
                    types={["image"]}
                    videoOnly={isGust}
                  />
                </motion.div>
              </div>

              {/* Mobile-only: remaining options in a dropdown. */}
              {isGust ? null : (
                <div className="max-md:block md:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label="More attachment options"
                        className={cn(
                          "pill-3d-hover text-muted-foreground inline-flex h-8 items-center justify-center rounded-full border-0 px-2 text-sm font-medium active:translate-y-px",
                          attachmentOptionsDisabled &&
                            "hover:from-none hover:to-none cursor-not-allowed opacity-50 hover:bg-none hover:shadow-none"
                        )}
                        disabled={attachmentOptionsDisabled}
                        type="button"
                      >
                        <MoreHorizontal className="size-5" size={20} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="apple-panel min-w-44 p-1.5 shadow-none"
                    >
                      <DropdownMenuItem
                        className="pill-3d-hover rounded-md px-2 py-2"
                        disabled={attachmentOptionsDisabled || mixedMediaLocked}
                        onClick={() => setGifPickerOpen((prev) => !prev)}
                      >
                        <span className="flex items-center gap-3">
                          <Clapperboard className="size-4" />
                          GIFs
                        </span>
                      </DropdownMenuItem>
                      <div className="flex items-center px-1 py-1">
                        <FileInput
                          disabled={
                            attachmentOptionsDisabled || mixedMediaLocked
                          }
                          onFilesSelected={startUpload}
                          types={["audio"]}
                        />
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {/* Desktop-only: the full inline toolbar (GIF + all file types). */}
              <div className="hidden items-center gap-1 md:flex">
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <FileInput
                    disabled={attachmentOptionsDisabled}
                    onFilesSelected={startUpload}
                    videoOnly={isGust}
                  />
                </motion.div>
                {isGust ? null : (
                  <motion.button
                    aria-label="Search and add a GIF"
                    className={cn(
                      "pill-3d-hover group text-muted-foreground inline-flex h-8 items-center justify-center rounded-full border-0 px-2 text-sm font-medium active:translate-y-px",
                      gifPickerOpen && "text-primary",
                      (attachmentOptionsDisabled || mixedMediaLocked) &&
                        "hover:from-none hover:to-none cursor-not-allowed opacity-50 hover:bg-none hover:shadow-none"
                    )}
                    disabled={attachmentOptionsDisabled || mixedMediaLocked}
                    onClick={() => setGifPickerOpen((prev) => !prev)}
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <span className="flex items-center gap-1.5">
                      <Clapperboard className="size-5" size={20} />
                      <span
                        className={cn(
                          "max-w-0 overflow-hidden text-xs font-medium whitespace-nowrap transition-all duration-200 ease-in-out",
                          gifPickerOpen ? "max-w-32" : "group-hover:max-w-32"
                        )}
                      >
                        GIFs
                      </span>
                    </span>
                  </motion.button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden md:flex">
                <ModeToggle disabled={isGroupMedia} isGust={isGust} />
              </div>
              <motion.div
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <LoadingButton
                  className="min-w-20"
                  disabled={
                    !(input.trim() || isHnSharing || hasPublishableMedia) ||
                    isUploading ||
                    hasUploadError ||
                    (isGust && gustCaptionExceeded) ||
                    (isGust && !hasGustVideo)
                  }
                  loading={mutation.isPending}
                  onClick={onSubmit}
                  variant="premium"
                >
                  {isGust ? "Gust" : "Post"}
                </LoadingButton>
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      {/* Capacity indicator: n/10 with context hints; turns warning near the
          cap and destructive at it. */}
      {!!attachments.length && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 tabular-nums",
              capacityChipClass(attachments.length, capacityFull)
            )}
          >
            {attachments.length}/{MAX_POST_ATTACHMENTS}
          </span>
          {capacityFull ? (
            <span className="text-destructive">limit reached</span>
          ) : (
            attachments.length > 1 && <span>drag the grip to reorder</span>
          )}
        </div>
      )}

      <AnimatePresence mode="wait">
        {!!attachments.length && (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            layout
            transition={{ duration: 0.3 }}
          >
            <AttachmentPreviews
              attachments={attachments}
              cancelUpload={cancelUpload}
              isGust={isGust}
              removeAttachment={removeAttachment}
              reorderAttachments={reorderAttachments}
              retryUpload={retryUpload}
              setAltText={setAltText}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface AttachmentPreviewsProps {
  attachments: Attachment[];
  cancelUpload: (fileName: string) => void;
  isGust: boolean;
  removeAttachment: (fileName: string) => void;
  reorderAttachments: (ordered: Attachment[]) => void;
  retryUpload: (fileName: string) => void;
  setAltText: (fileName: string, altText: string) => void;
}

const attachmentKeyOf = (attachment: Attachment, index: number): string =>
  attachment.file?.name ??
  attachment.mediaId ??
  attachment.name ??
  `attachment-${index}`;

/** One draggable grid tile: dnd-kit transform wrapper around the preview. */
const SortableAttachment = ({
  attachment,
  canReorder,
  index,
  isGust,
  onCancelClick,
  onEditAltClick,
  onRemoveClick,
  onRetryClick,
}: {
  attachment: Attachment;
  canReorder: boolean;
  index: number;
  isGust: boolean;
  onCancelClick: () => void;
  onEditAltClick?: () => void;
  onRemoveClick: () => void;
  onRetryClick: () => void;
}) => {
  const id = attachmentKeyOf(attachment, index);
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    opacity: isDragging ? 0.6 : undefined,
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="group/reorder relative">
        {/* Grip handle carries the drag listeners so clicks on the preview
            body (play button, remove X) never start a drag. */}
        {/* Reordering needs at least two tiles - a lone attachment has
            nothing to swap with, so its grip would be pure noise. */}
        {canReorder ? (
          <button
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            className="icon-btn-3d absolute top-2 left-2 z-20 flex h-7 w-7 cursor-grab items-center justify-center rounded-full p-0 opacity-0 transition-opacity duration-200 group-hover/reorder:opacity-100 active:cursor-grabbing"
            type="button"
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}
        <AttachmentPreview
          attachment={attachment}
          isGust={isGust}
          onCancelClick={onCancelClick}
          onEditAltClick={onEditAltClick}
          onRemoveClick={onRemoveClick}
          onRetryClick={onRetryClick}
        />
      </div>
    </div>
  );
};

const AttachmentPreviews = ({
  attachments,
  cancelUpload,
  isGust,
  removeAttachment,
  reorderAttachments,
  retryUpload,
  setAltText,
}: AttachmentPreviewsProps) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Small movement threshold so taps on previews don't become drags.
      activationConstraint: { distance: 6 },
    })
  );

  // Key of the attachment whose alt text editor is open; one shared dialog
  // serves every tile. Remounts per target via key so drafts never leak.
  const [altEditorKey, setAltEditorKey] = useState<string | null>(null);

  const handleRemoveClick = useCallback(
    (attachment: Attachment) => () => {
      removeAttachment(attachment.file?.name ?? attachment.name ?? "");
    },
    [removeAttachment]
  );

  const handleRetryClick = useCallback(
    (attachment: Attachment) => () => {
      retryUpload(attachment.file?.name ?? attachment.name ?? "");
    },
    [retryUpload]
  );

  const ids = attachments.map((a, i) => attachmentKeyOf(a, i));

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) {
        return;
      }
      const fromIndex = ids.indexOf(String(active.id));
      const toIndex = ids.indexOf(String(over.id));
      if (fromIndex === -1 || toIndex === -1) {
        return;
      }
      const next = [...attachments];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      reorderAttachments(next);
    },
    [attachments, ids, reorderAttachments]
  );

  // Image-only batches group into a tighter grid once there are enough of
  // them; videos (gusts) stay as single full-width tiles.
  const imageCount = attachments.filter((a) =>
    (a.file?.type ?? a.type ?? "").startsWith("image/")
  ).length;
  const showTightGrid =
    attachments.length >= 3 && imageCount === attachments.length;

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      sensors={sensors}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <motion.div
          animate="visible"
          className={cn(
            "flex flex-col gap-3",
            showTightGrid
              ? "grid grid-cols-3 gap-2"
              : attachments.length > 1 && "sm:grid sm:grid-cols-2"
          )}
          initial="hidden"
          variants={containerVariants}
        >
          {attachments.map((attachment, index) => {
            const attachmentKey = attachmentKeyOf(attachment, index);
            return (
              <motion.div
                animate={{ opacity: 1, scale: 1 }}
                custom={index}
                exit={{ opacity: 0, scale: 0.8 }}
                initial={{ opacity: 0, scale: 0.8 }}
                key={attachmentKey}
                transition={{
                  duration: 0.2,
                  layout: { duration: 0.2 },
                }}
                variants={itemVariants}
              >
                <SortableAttachment
                  attachment={attachment}
                  canReorder={attachments.length > 1}
                  index={index}
                  isGust={isGust}
                  onCancelClick={() =>
                    cancelUpload(attachment.file?.name ?? attachment.name ?? "")
                  }
                  onEditAltClick={() => setAltEditorKey(attachmentKey)}
                  onRemoveClick={handleRemoveClick(attachment)}
                  onRetryClick={handleRetryClick(attachment)}
                />
              </motion.div>
            );
          })}
        </motion.div>
      </SortableContext>
      {/* Inline alt text editor, attached directly under the grid it edits -
          same expanding-panel idiom as the GIF picker. */}
      <AnimatePresence>
        {(() => {
          if (!altEditorKey) {
            return null;
          }
          const altIndex = ids.indexOf(altEditorKey);
          const altTarget = altIndex === -1 ? undefined : attachments[altIndex];
          if (!altTarget) {
            return null;
          }
          return (
            <motion.div
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              initial={{ height: 0, opacity: 0 }}
              key={altEditorKey}
              transition={{ duration: 0.25, ease: "easeInOut" }}
            >
              <div className="mt-3 overflow-hidden">
                <AltTextPanel
                  attachment={altTarget}
                  onClose={() => setAltEditorKey(null)}
                  onSave={setAltText}
                />
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </DndContext>
  );
};

interface RemoveChipBaseProps {
  label: string;
  onRemove: (value: string) => void;
  removeLabel: string;
  value: string;
}

type RemoveChipProps = RemoveChipBaseProps &
  ({ user: UserData; variant: "mention" } | { user?: never; variant: "tag" });

const RemoveChip = ({
  label,
  onRemove,
  removeLabel,
  user,
  value,
  variant,
}: RemoveChipProps) => {
  const handleRemove = useCallback(() => {
    onRemove(value);
  }, [onRemove, value]);

  const leadingIcon = () => {
    if (variant === "mention") {
      return <UserAvatar avatarUrl={user.avatarUrl} className="h-4 w-4" />;
    }
    return <Hash className="meta-chip-accent h-3.5 w-3.5" />;
  };

  return (
    <span
      className={cn(
        "meta-chip",
        variant === "tag" ? "meta-chip-tag" : "meta-chip-mention"
      )}
    >
      {leadingIcon()}
      <span className="truncate">{label}</span>
      <button
        aria-label={removeLabel}
        className="meta-chip-accent text-muted-foreground hover:text-destructive ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors"
        onClick={handleRemove}
        type="button"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
};

const ModeToggle: React.FC<{ disabled?: boolean; isGust: boolean }> = ({
  disabled = false,
  isGust,
}) => {
  const setMode = useComposerStore((state) => state.setMode);

  const activeClasses =
    "bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";
  const idleClasses = "text-muted-foreground hover:text-foreground";

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border border-black/10 bg-[hsl(var(--background))] p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)] transition-opacity duration-200 dark:border-white/10 dark:bg-[#232323]",
        disabled && "pointer-events-none opacity-50"
      )}
      title={disabled ? "Remove extra media to switch post type" : undefined}
    >
      <button
        aria-label="Create a fleet post"
        aria-pressed={!isGust}
        className={cn(
          "rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-200",
          isGust ? idleClasses : activeClasses
        )}
        onClick={() => setMode("post")}
        type="button"
      >
        Fleets
      </button>
      <button
        aria-label="Create a gust"
        aria-pressed={isGust}
        className={cn(
          "rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-200",
          isGust ? activeClasses : idleClasses
        )}
        onClick={() => setMode("gust")}
        type="button"
      >
        Gust
      </button>
    </div>
  );
};
