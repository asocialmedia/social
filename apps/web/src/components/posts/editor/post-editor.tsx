"use client";

import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ClipboardEvent, useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useSession } from "@/app/(main)/session-provider";
import LoadingButton from "@/components/auth/loading-button";
import UserAvatar from "@/components/layouts/user-avatar";
import { cn } from "@/lib/utils";
import { useSubmitPostMutation } from "@/posts/editor/mutations";
import { AttachmentPreview } from "./attachment-preview";
import { FileInput } from "./file-input";
import "./styles.css";
import type { TagWithCount, UserData } from "@asm/db";
import { useHnShareStore } from "@asm/ui/store/hn-share-store";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
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
      },
    },
    immediatelyRender: false,
  });

  const [inputText, setInputText] = useState("");
  const input = inputText || editor?.getText({ blockSeparator: "\n" }) || "";
  const [_isEditorFocused, setIsEditorFocused] = useState(false);
  const [selectedTags, setSelectedTags] = useState<TagWithCount[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<UserData[]>([]);

  const removeTag = useCallback((tagName: string) => {
    setSelectedTags((prev) => prev.filter((t) => t.name !== tagName));
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
      prev.some((t) => t.name === tagName)
        ? prev
        : [
            ...prev,
            {
              id: tagName,
              name: tagName,
              _count: { posts: 0 },
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]
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
      tags: selectedTags.map((tag) => tag.name.toLowerCase()),
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
    <motion.div
      animate="visible"
      className="flex flex-col gap-5 rounded-none border-border border-t border-b bg-[#1a1a1a] p-5 shadow-none transition-shadow duration-300"
      initial="hidden"
      variants={containerVariants}
    >
      <motion.div className="flex gap-5" variants={itemVariants}>
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
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {selectedTags.map((tag) => (
                <RemoveChip
                  key={tag.name}
                  label={`#${tag.name}`}
                  onRemove={removeTag}
                  removeLabel={`Remove tag ${tag.name}`}
                  value={tag.name}
                />
              ))}
              {selectedMentions.map((mention) => (
                <RemoveChip
                  key={mention.id}
                  label={`@${mention.username}`}
                  onRemove={removeMention}
                  removeLabel={`Remove mention ${mention.username}`}
                  value={mention.id}
                />
              ))}
            </div>
          )}

          <div {...rootProps}>
            <motion.div
              className={cn(
                "relative rounded-2xl transition-all duration-300",
                isDragActive && "ring-2 ring-primary ring-offset-2"
              )}
              variants={itemVariants}
            >
              <EditorContent
                className={cn(
                  "premium-input max-h-[20rem] w-full overflow-y-auto px-5 py-3 text-foreground",
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
            </motion.div>
          </div>

          <motion.div
            className="mt-3 flex items-center justify-between gap-3"
            variants={itemVariants}
          >
            <motion.div
              className="flex items-center gap-3"
              variants={itemVariants}
            >
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
            </motion.div>

            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <LoadingButton
                className="min-w-24"
                disabled={!input.trim() || isUploading}
                loading={mutation.isPending}
                onClick={onSubmit}
                variant="premium"
              >
                Post
              </LoadingButton>
            </motion.div>
          </motion.div>
        </div>
      </motion.div>

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
    </motion.div>
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

interface RemoveChipProps {
  label: string;
  onRemove: (value: string) => void;
  removeLabel: string;
  value: string;
}

function RemoveChip({ label, onRemove, removeLabel, value }: RemoveChipProps) {
  const handleRemove = useCallback(() => {
    onRemove(value);
  }, [onRemove, value]);
  return (
    <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary text-sm">
      {label}
      <button
        aria-label={removeLabel}
        className="ml-0.5 rounded-full transition-colors hover:text-destructive"
        onClick={handleRemove}
        type="button"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
