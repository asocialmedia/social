"use client";

import type { UserData } from "@asm/db";
import { useHnShareStore } from "@asm/ui/store/hn-share-store";
import { useQuery } from "@tanstack/react-query";
import { Placeholder } from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Hash, Loader2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { useDropzone } from "react-dropzone";

import { useSession } from "@/app/(main)/session-provider";
import LoadingButton from "@/components/auth/loading-button";
import UserAvatar from "@/components/layouts/user-avatar";
import kyInstance from "@/lib/ky";

import "./styles.css";
import { cn } from "@/lib/utils";
import { useSubmitPostMutation } from "@/posts/editor/mutations";

import { AttachmentPreview } from "./attachment-preview";
import { FileInput } from "./file-input";
import { HNStoryPreview } from "./hn-story-preview";
import { InlineSuggestions } from "./inline-suggestions";
import useMediaUpload from "./use-media-upload";
import type { Attachment } from "./use-media-upload";

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

export default function PostEditor({
  variant = "feed",
}: {
  variant?: "feed" | "modal";
}) {
  const { user } = useSession();
  const mutation = useSubmitPostMutation();
  const hnShareStore = useHnShareStore();
  const sharedHnStory = hnShareStore.story;
  const isHnSharing = hnShareStore.isSharing;

  const { data: userData } = useQuery({
    enabled: Boolean(user),
    queryFn: () => kyInstance.get(`/api/users/${user?.id}`).json<UserData>(),
    queryKey: ["user", user?.id],
    staleTime: 1000 * 60 * 5,
  });

  const {
    startUpload,
    attachments,
    isUploading,
    uploadProgress,
    removeAttachment,
    reset: resetMediaUploads,
  } = useMediaUpload();

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "image/*": [],
      "video/*": [],
    },
    maxSize: 128 * 1024 * 1024,
    noClick: true,
    noKeyboard: true,
    onDrop: async (acceptedFiles: File[]) => {
      const validFiles = acceptedFiles.filter(
        (file: { type: string }) =>
          file.type.startsWith("image/") || file.type.startsWith("video/")
      );
      if (validFiles.length) {
        await startUpload(validFiles);
      }
    },
  });

  const rootProps = getRootProps();

  const [inputText, setInputText] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<UserData[]>([]);
  const onSubmitRef = useRef<(() => void) | null>(null);

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
        placeholder: "What's crack-a-lackin'?",
      }),
    ],
    immediatelyRender: false,
    onUpdate: ({ editor: currentEditor }) => {
      setInputText(currentEditor.getText({ blockSeparator: "\n" }) || "");
    },
  });

  const input = inputText || editor?.getText({ blockSeparator: "\n" }) || "";

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
    if (!(input.trim() || isHnSharing)) {
      return;
    }

    const payload = {
      content: input.trim(),
      mediaIds: attachments
        .map((a) => a.mediaId)
        .filter((id): id is string => Boolean(id)),
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

    if (!(payload.content || isHnSharing)) {
      return;
    }

    mutation.mutate(payload, {
      onSuccess: () => {
        editor?.commands.clearContent();
        setInputText("");
        resetMediaUploads();
        setSelectedTags([]);
        setSelectedMentions([]);
        if (isHnSharing) {
          hnShareStore.clearState();
        }
      },
    });
  }, [
    input,
    attachments,
    selectedTags,
    selectedMentions,
    mutation,
    editor,
    resetMediaUploads,
    isHnSharing,
    sharedHnStory,
    hnShareStore,
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
        <div className="w-full">
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
                    "premium-input text-foreground max-h-80 w-full overflow-y-auto px-5 py-3",
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
                    "premium-input text-foreground max-h-80 w-full overflow-y-auto px-5 py-3",
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
                  className="bg-primary/10 absolute inset-0 flex items-center justify-center rounded-2xl backdrop-blur-sm"
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

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <AnimatePresence>
                {isUploading ? (
                  <motion.div
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2"
                    exit={{ opacity: 0, x: -20 }}
                    initial={{ opacity: 0, x: -20 }}
                  >
                    <span className="text-sm font-medium tabular-nums">
                      {(uploadProgress ?? 0).toFixed(1)}%
                    </span>
                    <Loader2 className="text-primary size-5 animate-spin" />
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <motion.div
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <FileInput
                  disabled={isUploading || attachments.length >= 5}
                  onFilesSelected={startUpload}
                />
              </motion.div>
            </div>

            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <LoadingButton
                className="min-w-20"
                disabled={!(input.trim() || isHnSharing) || isUploading}
                loading={mutation.isPending}
                onClick={onSubmit}
                variant="premium"
              >
                Post
              </LoadingButton>
            </motion.div>
          </div>
        </div>
      </div>

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
              removeAttachment={removeAttachment}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface AttachmentPreviewsProps {
  attachments: Attachment[];
  removeAttachment: (fileName: string) => void;
}

const AttachmentPreviews = ({
  attachments,
  removeAttachment,
}: AttachmentPreviewsProps) => {
  const handleRemoveClick = useCallback(
    (attachment: Attachment) => () => {
      removeAttachment(attachment.file.name);
    },
    [removeAttachment]
  );

  return (
    <motion.div
      animate="visible"
      className={cn(
        "flex flex-col gap-3",
        attachments.length > 1 && "sm:grid sm:grid-cols-2"
      )}
      initial="hidden"
      variants={containerVariants}
    >
      {attachments.map((attachment, index) => (
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          custom={index}
          exit={{ opacity: 0, scale: 0.8 }}
          initial={{ opacity: 0, scale: 0.8 }}
          key={attachment.file.name}
          layoutId={attachment.file.name}
          transition={{
            duration: 0.2,
            layout: { duration: 0.2 },
          }}
          variants={itemVariants}
        >
          <AttachmentPreview
            attachment={attachment}
            onRemoveClick={handleRemoveClick(attachment)}
          />
        </motion.div>
      ))}
    </motion.div>
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
