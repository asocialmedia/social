"use client";

import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Hash, Loader2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type ClipboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useDropzone } from "react-dropzone";
import { useSession } from "@/app/(main)/session-provider";
import LoadingButton from "@/components/auth/loading-button";
import UserAvatar from "@/components/layouts/user-avatar";
import { cn } from "@/lib/utils";
import { useSubmitPostMutation } from "@/posts/editor/mutations";
import { AttachmentPreview } from "./attachment-preview";
import { FileInput } from "./file-input";
import "./styles.css";
import type { UserData } from "@asm/db";
import { useHnShareStore } from "@asm/ui/store/hn-share-store";
import { useQuery } from "@tanstack/react-query";
import kyInstance from "@/lib/ky";
import { HNStoryPreview } from "./hn-story-preview";
import { InlineSuggestions } from "./inline-suggestions";
import useMediaUpload, { type Attachment } from "./use-media-upload";

const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

export default function PostEditor() {
  const { user } = useSession();
  const mutation = useSubmitPostMutation();
  const hnShareStore = useHnShareStore();
  const sharedHnStory = hnShareStore.story;
  const isHnSharing = hnShareStore.isSharing;

  const { data: userData } = useQuery({
    queryKey: ["user", user.id],
    queryFn: () => kyInstance.get(`/api/users/${user.id}`).json<UserData>(),
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
    // biome-ignore lint/suspicious/noExplicitAny: any
    onDrop: async (acceptedFiles: any[]) => {
      const validFiles = acceptedFiles.filter(
        (file: { type: string }) =>
          file.type.startsWith("image/") || file.type.startsWith("video/")
      );
      if (validFiles.length) {
        await startUpload(validFiles);
      }
    },
    accept: {
      "image/*": [],
      "video/*": [],
    },
    maxSize: 128 * 1024 * 1024,
    noClick: true,
    noKeyboard: true,
  });

  const rootProps = getRootProps();

  const [inputText, setInputText] = useState("");
  const [_isEditorFocused, setIsEditorFocused] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<UserData[]>([]);
  const onSubmitRef = useRef<(() => void) | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bold: false,
        italic: false,
      }),
      Placeholder.configure({
        placeholder: "What's crack-a-lackin'?",
      }),
    ],
    onUpdate: ({ editor: currentEditor }) => {
      setInputText(currentEditor.getText({ blockSeparator: "\n" }) || "");
    },
    editorProps: {
      attributes: {
        class: "focus:outline-none",
      },
      handleDOMEvents: {
        focus: () => {
          setIsEditorFocused(true);
          return false;
        },
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
    immediatelyRender: false,
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
      tags: selectedTags.map((tag) => tag.toLowerCase()),
      mentions: selectedMentions.map((mentionedUser) => mentionedUser.id),
      ...(isHnSharing && sharedHnStory
        ? {
            hnStory: {
              storyId: sharedHnStory.id,
              title: sharedHnStory.title,
              url: sharedHnStory.url,
              by: sharedHnStory.by,
              time: sharedHnStory.time,
              score: sharedHnStory.score,
              descendants: sharedHnStory.descendants,
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
        setIsEditorFocused(false);
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
      const files = Array.from(e.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile()) as File[];
      startUpload(files);
    },
    [startUpload]
  );

  return (
    <div className="flex flex-col gap-5 rounded-none border-border border-t border-b bg-[hsl(var(--background-alt))] p-5 shadow-none transition-shadow duration-300">
      <div className="flex gap-5">
        <div className="hidden sm:inline">
          <motion.div
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <UserAvatar avatarUrl={userData?.avatarUrl || user.image} />
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
                isDragActive && "ring-2 ring-primary ring-offset-2"
              )}
            >
              <EditorContent
                className={cn(
                  "premium-input max-h-80 w-full overflow-y-auto px-5 py-3 text-foreground",
                  "transition-all duration-300 ease-in-out",
                  "focus-within:ring-2 focus-within:ring-primary",
                  isDragActive && "outline-dashed outline-primary"
                )}
                editor={editor}
                onPaste={onPaste}
              />
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
                  className="absolute inset-0 flex items-center justify-center rounded-2xl bg-primary/10 backdrop-blur-sm"
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                >
                  <p className="font-medium text-lg text-primary">
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
                style={{ width: 0, height: 0 }}
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
                    <span className="font-medium text-sm tabular-nums">
                      {(uploadProgress ?? 0).toFixed(1)}%
                    </span>
                    <Loader2 className="size-5 animate-spin text-primary" />
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
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            initial={{ opacity: 0, height: 0 }}
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

function AttachmentPreviews({
  attachments,
  removeAttachment,
}: AttachmentPreviewsProps) {
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
}

interface RemoveChipBaseProps {
  label: string;
  onRemove: (value: string) => void;
  removeLabel: string;
  value: string;
}

type RemoveChipProps = RemoveChipBaseProps &
  ({ user: UserData; variant: "mention" } | { user?: never; variant: "tag" });

function RemoveChip({
  label,
  onRemove,
  removeLabel,
  user,
  value,
  variant,
}: RemoveChipProps) {
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
        className="meta-chip-accent ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-destructive"
        onClick={handleRemove}
        type="button"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
