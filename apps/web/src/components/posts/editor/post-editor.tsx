"use client";

import type { UserData } from "@asm/db";
import { MAX_POST_ATTACHMENTS } from "@asm/media";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { Skeleton } from "@asm/ui/shadui/skeleton";
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
  Image as ImageIcon,
  MoreHorizontal,
  Music,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ClipboardEvent } from "react";
import { useDropzone } from "react-dropzone";

import { useSession } from "@/app/(main)/session-provider";
import { LoadingButton } from "@/components/auth/loading-button";
import KlipyGifPicker from "@/components/comments/klipy-gif-picker";
import type { KlipyGif } from "@/components/comments/klipy-gif-picker";
import UserAvatar from "@/components/layouts/user-avatar";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import {
  ALT_TEXT_MAX_LENGTH,
  patchAudioOverlay,
  patchThumbnail,
  uploadMediaFile,
} from "@/lib/media-upload-client";

import "./styles.css";
import { cn } from "@/lib/utils";
import { useSubmitPostMutation } from "@/posts/editor/mutations";
import { useComposerStore } from "@/store/composer-store";

import AltTextPanel from "./alt-text-panel";
import { AttachmentPreview } from "./attachment-preview";
import { useComposerAttachmentStore } from "./attachment-store";
import { FileInput } from "./file-input";
import { GustMentionPicker, GustTagPicker } from "./gust-meta-pickers";
import { HNStoryPreview } from "./hn-story-preview";
import { InlineSuggestions } from "./inline-suggestions";
import LinkEmbedComposer from "./link-embed-composer";
import useMediaUpload from "./use-media-upload";
import type { Attachment } from "./use-media-upload";

export const GUST_CAPTION_MAX_WORDS = 150;
export const GUST_CAPTION_MAX_CHARS = 900;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Mounted detection for hydration-safe interactive state (see PostEditor).
const subscribeNoop = (): (() => void) => () => {
  /* empty */
};
const getMountedSnapshot = (): boolean => true;
const getServerSnapshotFalse = (): boolean => false;

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
  // Shared one-at-a-time upload gate (sound + thumbnail uploads raise it).
  const setUploading = useComposerAttachmentStore((s) => s.setUploading);

  // Shared contract with the server-side cap in submitPost.
  const capacityFull = attachments.length >= MAX_POST_ATTACHMENTS;
  // The gust video's attachment row, when one is attached. The sound-overlay
  // endpoint needs its media id to bake a later-picked sound into the video;
  // its upload state drives the thumbnail skeleton while the pipeline has
  // not produced a poster yet.
  const gustVideoAttachment = attachments.find((a) =>
    (a.file?.type ?? a.type ?? "").startsWith("video/")
  );
  const gustVideoMediaId = gustVideoAttachment?.mediaId;
  const gustVideoProcessing = gustVideoAttachment?.isUploading ?? false;
  // A single attachment still offers gust switching; only an actual video
  // makes the post video-only (GIFs and audio lock, matching how published
  // posts render video). Audio mixes freely with images/GIFs/videos - the
  // feed's bento/grid tiles already render AUDIO cells alongside the rest.
  const isGroupMedia = attachments.length > 1;
  const hasVideoAttachment = attachments.some((a) =>
    (a.file?.type ?? a.type ?? "").startsWith("video/")
  );
  const mixedMediaLocked = hasVideoAttachment;
  const attachmentOptionsDisabled = isUploading || capacityFull;
  // A gust is one video at a time: the moment one exists (uploading or
  // settled) the pickers disappear - tapping the preview replaces the clip.
  const gustPickerHidden = isGust && hasVideoAttachment;
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
        await startUpload(validFiles, {
          audioOverlayId: isGust ? (soundTrack?.mediaId ?? null) : null,
        });
      }
    },
  });

  const rootProps = getRootProps();

  const { toast } = useToast();
  const [inputText, setInputText] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<UserData[]>([]);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  // Links whose live preview the author dismissed in the composer; excluded
  // from the stored embed set at publish.
  const [dismissedEmbedUrls, setDismissedEmbedUrls] = useState<string[]>([]);
  // Gust "sound": an audio track that replaces the video's own audio during
  // pipeline processing. Uploaded through the same pipeline (purpose post);
  // its mediaId rides along on the video upload as audioOverlayId.
  const [soundTrack, setSoundTrack] = useState<{
    file: File;
    mediaId: string | null;
    status: "uploading" | "ready" | "error";
  } | null>(null);
  const soundInputRef = useRef<HTMLInputElement>(null);
  const onSubmitRef = useRef<(() => void) | null>(null);
  // Key of the attachment whose alt text editor is open; one shared panel
  // serves every tile. Lives here (not inside AttachmentPreviews) so the gust
  // layout can place it under the caption input instead of under the video.
  const [altEditorKey, setAltEditorKey] = useState<string | null>(null);
  // Unsaved alt text drafts keyed by attachment key. The docked gust field
  // writes here as the user types; the draft is flushed to the media row
  // when the gust is published.
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});

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
    [setGifPickerOpen, startUpload, toast]
  );

  const handleSoundFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file || !file.type.startsWith("audio/")) {
        return;
      }
      setSoundTrack({ file, mediaId: null, status: "uploading" });
      // The sound upload is not a composer attachment, so it bypasses
      // startUpload - raise the shared gate manually so video/image uploads
      // disable while it is in flight.
      setUploading(true);
      try {
        const result = await uploadMediaFile(file, { purpose: "post" });
        if (result.status === "READY" && result.mediaId) {
          // The video row already exists (the sound button only appears once
          // a video is attached), so the overlay is attached after the fact.
          // The endpoint also re-runs derivative generation when the video
          // was already processed without the sound.
          if (
            !gustVideoMediaId ||
            !(await patchAudioOverlay(gustVideoMediaId, result.mediaId))
          ) {
            setSoundTrack({ file, mediaId: null, status: "error" });
            toast({
              description: "Couldn't attach that sound - try again?",
              title: "Sound Failed",
              variant: "destructive",
            });
            setUploading(false);
            return;
          }
          setSoundTrack({ file, mediaId: result.mediaId, status: "ready" });
        } else {
          setSoundTrack({ file, mediaId: null, status: "error" });
        }
      } catch {
        setSoundTrack({ file, mediaId: null, status: "error" });
      }
      setUploading(false);
    },
    [gustVideoMediaId, setSoundTrack, setUploading, toast]
  );

  const handleSoundInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      void handleSoundFile(event.target.files?.[0]);
      event.target.value = "";
    },
    [handleSoundFile]
  );

  // "Tap the preview to change your gust": opens the picker; on an actual
  // selection the old clip's attachment is dropped (server draft discarded)
  // and the new video uploads in its place, with the sound track riding
  // along as the overlay. Cancelling the dialog leaves everything untouched.
  const gustVideoInputRef = useRef<HTMLInputElement>(null);
  const requestGustVideoChange = useCallback(() => {
    // One upload at a time; mid-upload the preview tile is visibly busy.
    if (isUploading) {
      return;
    }
    gustVideoInputRef.current?.click();
  }, [isUploading]);
  const handleGustVideoInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !file.type.startsWith("video/")) {
        return;
      }
      const current = attachments.find((a) =>
        (a.file?.type ?? a.type ?? "").startsWith("video/")
      );
      if (current) {
        removeAttachment(current.file?.name ?? current.name ?? "");
      }
      void startUpload([file], {
        audioOverlayId: isGust ? (soundTrack?.mediaId ?? null) : null,
      });
    },
    [attachments, isGust, removeAttachment, soundTrack, startUpload]
  );

  // Gust custom thumbnail: an uploaded image copied onto the video row by
  // the thumbnail endpoint; the serving route prefers it over the generated
  // poster. thumbBust cache-busts the preview after each change.
  const [thumbnail, setThumbnail] = useState<{
    file: File;
    mediaId: string;
    status: "uploading" | "ready" | "error";
  } | null>(null);
  const [thumbBust, setThumbBust] = useState(0);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  const handleThumbnailFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file || !file.type.startsWith("image/") || !gustVideoMediaId) {
        return;
      }
      setThumbnail({ file, mediaId: "", status: "uploading" });
      try {
        const result = await uploadMediaFile(file, { purpose: "post" });
        if (result.status === "READY" && result.mediaId) {
          if (!(await patchThumbnail(gustVideoMediaId, result.mediaId))) {
            setThumbnail({ file, mediaId: "", status: "error" });
            toast({
              description: "Couldn't set that thumbnail - try again?",
              title: "Thumbnail Failed",
              variant: "destructive",
            });
            return;
          }
          setThumbnail({ file, mediaId: result.mediaId, status: "ready" });
          setThumbBust(Date.now());
        } else {
          setThumbnail({ file, mediaId: "", status: "error" });
        }
      } catch {
        setThumbnail({ file, mediaId: "", status: "error" });
      }
    },
    [gustVideoMediaId, setThumbBust, setThumbnail, toast]
  );

  const handleThumbnailInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      void handleThumbnailFile(event.target.files?.[0]);
      event.target.value = "";
    },
    [handleThumbnailFile]
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

  const removeTag = useCallback(
    (tagName: string) => {
      setSelectedTags((prev) => prev.filter((t) => t !== tagName));
    },
    [setSelectedTags]
  );

  const removeMention = useCallback(
    (userId: string) => {
      setSelectedMentions((prev) => prev.filter((m) => m.id !== userId));
    },
    [setSelectedMentions]
  );

  const addMention = useCallback(
    (mentionUser: UserData) => {
      setSelectedMentions((prev) =>
        prev.some((m) => m.id === mentionUser.id)
          ? prev
          : [...prev, mentionUser]
      );
    },
    [setSelectedMentions]
  );

  const addTag = useCallback(
    (tagName: string) => {
      setSelectedTags((prev) =>
        prev.some((t) => t === tagName) ? prev : [...prev, tagName]
      );
    },
    [setSelectedTags]
  );

  useEffect(() => {
    if (isHnSharing && editor) {
      editor.commands.focus();
      editor.commands.setContent(`Sharing: "${sharedHnStory?.title}"`);
      setTimeout(() => {
        editor.commands.selectAll();
      }, 100);
    }
  }, [isHnSharing, sharedHnStory, editor]);

  // oxlint-disable react/preserve-manual-memoization -- onSubmit closes over the composer's whole mutable surface; the compiler infers every setter it can reach, far beyond the declared deps
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
      dismissedEmbedUrls,
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

    // Publish-time flush of the docked gust alt field: the draft lives only
    // in local state while composing; now that the gust is actually going
    // out, write it to the media row (setAltText PATCHes immediately - the
    // row exists and is READY by publish time). Emptying the field clears a
    // previously saved description.
    if (isGust) {
      const videoIndex = attachments.findIndex((a) =>
        (a.file?.type ?? a.type ?? "").startsWith("video/")
      );
      const video = videoIndex === -1 ? undefined : attachments[videoIndex];
      if (video) {
        const draft = (altDrafts[attachmentKeyOf(video, videoIndex)] ?? "")
          .trim()
          .slice(0, ALT_TEXT_MAX_LENGTH);
        if (draft !== (video.altText ?? "")) {
          setAltText(video.file?.name ?? video.name ?? "attachment", draft);
        }
      }
    }

    mutation.mutate(payload, {
      onSuccess: (newPost) => {
        editor?.commands.clearContent();
        setInputText("");
        resetMediaUploads();
        setAltDrafts({});
        setSelectedTags([]);
        setSelectedMentions([]);
        setDismissedEmbedUrls([]);
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
    altDrafts,
    dismissedEmbedUrls,
    hasPublishableMedia,
    hasUploadError,
    selectedTags,
    selectedMentions,
    mutation,
    editor,
    resetMediaUploads,
    setAltText,
    isHnSharing,
    sharedHnStory,
    hnShareStore,
    isGust,
    gustCaptionExceeded,
    hasGustVideo,
    router,
    setGifPickerOpen,
    setSelectedMentions,
    toast,
  ]);
  // oxlint-enable react/preserve-manual-memoization

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  // The HN-share store persists to sessionStorage; pull its state in after
  // hydration so the server render and the client's first render agree
  // (otherwise a stored isSharing flips the publish button's disabled state
  // mid-hydration).
  useEffect(() => {
    void useHnShareStore.persist.rehydrate();
  }, []);

  const handleRemoveHnStory = useCallback(() => {
    hnShareStore.clearState();
  }, [hnShareStore]);

  const previewsBlock = (
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
            onAltEditRequest={setAltEditorKey}
            onChangeVideoRequest={isGust ? requestGustVideoChange : undefined}
            removeAttachment={removeAttachment}
            reorderAttachments={reorderAttachments}
            retryUpload={retryUpload}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Gust status line: sits under the video preview once a clip exists
  // ("tap the preview to change it"), or above the caption fields while
  // there is no video yet. Carries the caption counter near the limits.
  const gustHintLine = (
    <output className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {hasGustVideo ? (
        <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
          Tap the preview to change your gust
          <span className="rounded-full bg-[#ff9500]/10 px-2 py-0.5 text-[10px] font-bold text-[#ff9500]">
            9:16
          </span>
        </span>
      ) : (
        <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
          Attach a 9:16 video to publish a gust
        </span>
      )}
      {/* Counter appears only near/over the word or char limit */}
      {gustCaptionNearLimit ? (
        <span
          className={cn(
            "font-medium tabular-nums",
            gustCaptionExceeded ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {gustWordCount}/{GUST_CAPTION_MAX_WORDS} words · {input.length}/
          {GUST_CAPTION_MAX_CHARS} chars
        </span>
      ) : null}
    </output>
  );

  // Volatile composer state (persisted HN-share flag, restored drafts) can
  // legitimately differ from the server render; gating the publish button's
  // disabled state on mount keeps the SSR'd markup and the client's first
  // render identical no matter what the stores restore. useSyncExternalStore
  // yields false through SSR + hydration and true on the first client pass.
  const isComposerMounted = useSyncExternalStore(
    subscribeNoop,
    getMountedSnapshot,
    getServerSnapshotFalse
  );

  // Shared publish button: fleet keeps it in the toolbar; gust renders it
  // below the sound section.
  const publishButton = (
    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
      <LoadingButton
        className="min-w-20"
        disabled={
          !isComposerMounted ||
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
  );

  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      const files = [...e.clipboardData.items]
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile()) as File[];
      startUpload(files, {
        audioOverlayId: isGust ? (soundTrack?.mediaId ?? null) : null,
      });
    },
    [startUpload, isGust, soundTrack]
  );

  const uploadWithOverlay = useCallback(
    (files: File[]) =>
      startUpload(files, {
        audioOverlayId: isGust ? (soundTrack?.mediaId ?? null) : null,
      }),
    [isGust, soundTrack, startUpload]
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
      {/* The avatar leads the composer on every breakpoint: the fleet/gust
          switcher and the input bar sit beside it on mobile too. Gust mode
          with a clip keeps its stacked mobile grid instead - there the
          avatar leads the rail beside the thumbnail and the outer copy is
          hidden. */}
      <div
        className={cn(
          "flex gap-5",
          isGust && hasVideoAttachment && "max-sm:flex-col"
        )}
      >
        <div
          className={cn(
            "mt-1 shrink-0",
            isGust && hasVideoAttachment && "max-sm:hidden"
          )}
        >
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
        <div
          className={cn(
            "w-full min-w-0",
            // Gust mode composes like a reels screen: video and thumbnail
            // side by side on mobile, then the caption/alt fields, options
            // strip, and publish. On sm+ the video column leads and the
            // fields stack in the right rail.
            isGust &&
              hasVideoAttachment &&
              "grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-start sm:gap-4"
          )}
        >
          {/* Gust mode: the avatar leads the left rail on mobile (thumbnail
              rises to the same top line beside it); on sm+ the outer avatar
              beside the composer takes over. The fleet/gust switcher leads
              the rail on sm+ and sits on the publish row on mobile. */}
          {isGust && hasVideoAttachment ? (
            <div className="min-w-0">
              <div className="mb-3 sm:hidden">
                <UserAvatar
                  avatarUrl={userData?.avatarUrl || user.image}
                  className="size-10 shrink-0 rounded-xl ring-2 ring-white/60"
                />
              </div>
              <div className="mb-2 flex max-sm:hidden">
                <ModeToggle disabled={isGroupMedia} isGust={isGust} />
              </div>
              {previewsBlock}
              {gustHintLine}
            </div>
          ) : null}
          {isGust && !hasVideoAttachment ? (
            <div className="mb-2 flex max-sm:hidden">
              <ModeToggle disabled={isGroupMedia} isGust={isGust} />
            </div>
          ) : null}
          <div
            className={cn(
              "min-w-0",
              // On mobile the rail dissolves so its fields can span the full
              // width while the thumbnail escapes beside the video.
              isGust && hasVideoAttachment && "max-sm:[display:contents]"
            )}
          >
            {/* Mobile-only mode switcher above the editor so the Post button stays on screen (fleet mode; gust carries its own at the top) */}
            {isGust ? null : (
              <div className="mb-3 flex md:hidden">
                <ModeToggle disabled={isGroupMedia} isGust={isGust} />
              </div>
            )}
            {/* Fleet mode renders selected tags/mentions above the editor;
                gust mode carries them inside its picker sections instead. */}
            {!isGust &&
              (selectedTags.length > 0 || selectedMentions.length > 0) && (
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

            {/* Gust field headings: label + what the field does, on one line. */}
            {isGust ? (
              <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 max-sm:col-span-2">
                <p className="text-xs font-semibold">Caption</p>
                <p className="text-muted-foreground text-[11px]">
                  Tell viewers what your gust is about.
                </p>
              </div>
            ) : null}

            <div {...rootProps} className="max-sm:col-span-2">
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
                        {isGust
                          ? "Add a caption for your gust..."
                          : "What's crack-a-lackin'?"}
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
                {/* Live link previews: resolve as the author types, dismiss
                    to keep a link plain text in the published post. */}
                {isHnSharing ? null : (
                  <LinkEmbedComposer
                    content={input}
                    dismissedUrls={new Set<string>(dismissedEmbedUrls)}
                    onDismiss={(url) =>
                      setDismissedEmbedUrls((prev) =>
                        prev.includes(url) ? prev : [...prev, url]
                      )
                    }
                  />
                )}
                {/* Hidden file input for drag & drop - positioned absolutely to avoid interfering with editor clicks */}
                <input
                  {...getInputProps()}
                  className="pointer-events-none absolute inset-0 opacity-0"
                  style={{ height: 0, width: 0 }}
                />
                {/* Hidden picker for "tap the preview to change your gust" -
                    selecting a file swaps the clip in place. */}
                {isGust ? (
                  <input
                    accept="video/*"
                    aria-label="Change gust video"
                    className="sr-only"
                    onChange={handleGustVideoInputChange}
                    ref={gustVideoInputRef}
                    type="file"
                  />
                ) : null}
              </div>
            </div>

            {/* Gust alt text editor: a bare field styled like the caption
                input, always docked below its heading. The draft flushes to
                the media row on publish - nothing to click here. */}
            {isGust && hasGustVideo ? (
              <div className="mt-3 mb-1 flex items-baseline gap-x-2 max-sm:col-span-2 max-sm:mb-0">
                <p className="text-xs font-semibold whitespace-nowrap">
                  Alt text
                </p>
                <p className="text-muted-foreground min-w-0 truncate text-[11px]">
                  For viewers who can&apos;t see it.
                </p>
              </div>
            ) : null}
            {isGust && hasGustVideo ? (
              <div className="max-sm:col-span-2 max-sm:-mt-3">
                <AltTextEditorPanel
                  altDrafts={altDrafts}
                  altEditorKey={altEditorKey}
                  attachments={attachments}
                  onClose={() => setAltEditorKey(null)}
                  onDraftChange={(attachmentKey, draft) =>
                    setAltDrafts((prev) => ({
                      ...prev,
                      [attachmentKey]: draft,
                    }))
                  }
                  onSave={setAltText}
                  variant="docked"
                />
              </div>
            ) : null}

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

            {/* With a video the hint lives under the preview; this copy
                covers the no-video state only. */}
            {isGust && !hasGustVideo ? gustHintLine : null}

            {/* Toolbar: in gust mode with a video every control here is
                hidden or relocated (pickers gone, publish under sound), so
                the empty row is skipped entirely. */}
            {isGust && hasVideoAttachment ? null : (
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {/* Mobile-only: inline image/video button; the rest collapse into
                  a dropdown. */}
                  <div className="max-md:flex md:hidden">
                    {gustPickerHidden ? null : (
                      <motion.div
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <FileInput
                          disabled={attachmentOptionsDisabled}
                          onFilesSelected={uploadWithOverlay}
                          types={["image"]}
                          videoOnly={isGust}
                        />
                      </motion.div>
                    )}
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
                            disabled={
                              attachmentOptionsDisabled || mixedMediaLocked
                            }
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
                              onFilesSelected={uploadWithOverlay}
                              types={["audio"]}
                            />
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {/* Desktop-only: the full inline toolbar (GIF + all file types). */}
                  <div className="hidden items-center gap-1 md:flex">
                    {gustPickerHidden ? null : (
                      <motion.div
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <FileInput
                          disabled={attachmentOptionsDisabled}
                          onFilesSelected={uploadWithOverlay}
                          videoOnly={isGust}
                        />
                      </motion.div>
                    )}
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
                              gifPickerOpen
                                ? "max-w-32"
                                : "group-hover:max-w-32"
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
                  {isGust ? null : (
                    <div className="hidden md:flex">
                      <ModeToggle disabled={isGroupMedia} isGust={isGust} />
                    </div>
                  )}
                  {isGust ? null : publishButton}
                </div>
              </div>
            )}

            {/* Thumbnail + sound: a two-column strip under the text fields,
                so neither section waits on the video column's height. */}
            {isGust && hasGustVideo ? (
              <div className="mt-3 grid gap-4 max-sm:col-span-2 max-sm:[display:contents] sm:grid-cols-2">
                {/* Gust thumbnail: vertical 9:16 like the clip above it. The
                    preview always reflects the served ?thumb=1 (custom cover
                    once attached, generated poster otherwise); the uploaded
                    image's bytes are copied onto the video row server-side. */}
                {isGust && hasGustVideo ? (
                  <div className="min-w-0 max-sm:col-start-2 max-sm:row-start-1">
                    <p className="text-muted-foreground mb-2 line-clamp-2 text-[11px] leading-snug">
                      <span className="text-foreground text-xs font-semibold whitespace-nowrap">
                        Thumbnail
                      </span>{" "}
                      Optional - pick a cover frame; one is chosen from the
                      video otherwise.
                    </p>
                    {/* While the pipeline is still working on the clip there
                        is no cover to show (or change): a skeleton holds the
                        slot until the poster lands. */}
                    {gustVideoProcessing || !gustVideoMediaId ? (
                      <Skeleton className="aspect-9/16 w-36 max-w-full rounded-2xl max-sm:w-full" />
                    ) : (
                      <button
                        aria-label="Change thumbnail"
                        className="group/thumb relative aspect-9/16 w-36 max-w-full cursor-pointer overflow-hidden rounded-2xl max-sm:w-full"
                        disabled={isUploading}
                        onClick={() => thumbnailInputRef.current?.click()}
                        type="button"
                      >
                        {/* oxlint-disable-next-line @next/next/no-img-element -- live preview of the private-bucket thumbnail route */}
                        <img
                          alt="Current thumbnail"
                          className="absolute inset-0 h-full w-full object-cover"
                          src={`/api/media/${gustVideoMediaId}?thumb=1${
                            thumbBust ? `&t=${thumbBust}` : ""
                          }`}
                        />
                        <span className="absolute inset-0 z-10 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover/thumb:bg-black/30">
                          <span className="rail-3d-btn flex h-9 w-9 items-center justify-center rounded-full opacity-0 transition-opacity duration-200 group-hover/thumb:opacity-100">
                            <ImageIcon className="size-4" />
                          </span>
                        </span>
                      </button>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {thumbnail?.status === "error" ? (
                        <span className="rail-3d-btn text-destructive rounded-full px-2.5 py-1 text-[11px] font-medium">
                          failed - try again
                        </span>
                      ) : null}
                      {thumbnail && thumbnail.status !== "error" ? (
                        <span className="rail-3d-btn flex min-w-0 items-center gap-2 rounded-full py-1.5 pr-1.5 pl-3 text-xs font-medium">
                          <ImageIcon className="size-3.5 shrink-0 text-[#7c5cff]" />
                          <span className="max-w-36 truncate">
                            {thumbnail.file.name}
                          </span>
                          {thumbnail.status === "uploading" ? (
                            <span className="text-muted-foreground text-[10px]">
                              uploading…
                            </span>
                          ) : null}
                          <button
                            aria-label="Remove custom thumbnail"
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10"
                            onClick={() => {
                              if (gustVideoMediaId) {
                                void patchThumbnail(gustVideoMediaId, null);
                              }
                              setThumbnail(null);
                              setThumbBust(Date.now());
                            }}
                            type="button"
                          >
                            <X className="size-3.5" />
                          </button>
                        </span>
                      ) : null}
                      <input
                        accept="image/*"
                        aria-label="Custom thumbnail for this gust"
                        className="sr-only"
                        onChange={handleThumbnailInputChange}
                        ref={thumbnailInputRef}
                        type="file"
                      />
                    </div>
                  </div>
                ) : null}

                {/* Right column: sound, with the tag + mention pickers
                    stacked beneath it. On mobile the column dissolves so
                    sound, tags, and mentions span the full width. */}
                <div className="flex min-w-0 flex-col gap-3 max-sm:col-span-2">
                  <div className="min-w-0">
                    <div className="mb-2 flex items-baseline gap-x-2">
                      <p className="text-xs font-semibold whitespace-nowrap">
                        Sound
                      </p>
                      <p className="text-muted-foreground min-w-0 truncate text-[11px]">
                        Optional - replace the clip&apos;s audio.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {soundTrack ? (
                        <span className="rail-3d-btn flex min-w-0 items-center gap-2 rounded-full py-1.5 pr-1.5 pl-3 text-xs font-medium">
                          <Music className="size-3.5 shrink-0 text-[#7c5cff]" />
                          <span className="max-w-36 truncate">
                            {soundTrack.file.name}
                          </span>
                          {soundTrack.status === "uploading" ? (
                            <span className="text-muted-foreground text-[10px]">
                              uploading…
                            </span>
                          ) : null}
                          {soundTrack.status === "error" ? (
                            <span className="text-destructive text-[10px]">
                              failed
                            </span>
                          ) : null}
                          <button
                            aria-label="Remove sound track"
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10"
                            onClick={() => {
                              if (gustVideoMediaId) {
                                void patchAudioOverlay(gustVideoMediaId, null);
                              }
                              setSoundTrack(null);
                            }}
                            type="button"
                          >
                            <X className="size-3.5" />
                          </button>
                        </span>
                      ) : (
                        <button
                          aria-label="Add sound"
                          className="pill-3d-hover text-muted-foreground inline-flex h-8 items-center justify-center gap-1.5 rounded-full border-0 px-3 text-xs font-medium"
                          disabled={isUploading}
                          onClick={() => soundInputRef.current?.click()}
                          type="button"
                        >
                          <Music className="size-3.5" />
                          Add sound
                        </button>
                      )}
                      <input
                        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
                        aria-label="Sound track for this gust"
                        className="sr-only"
                        onChange={handleSoundInputChange}
                        ref={soundInputRef}
                        type="file"
                      />
                    </div>
                  </div>

                  {/* Tags + mentions: stacked pickers under the sound, fed
                      by the same state as the caption's inline # / @
                      suggestions. */}
                  <GustTagPicker
                    onAdd={addTag}
                    onRemove={removeTag}
                    selectedTags={selectedTags}
                  />
                  <GustMentionPicker
                    onAdd={addMention}
                    onRemove={removeMention}
                    selectedMentions={selectedMentions}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Gust publish: switcher bottom-left, button bottom-right on
              mobile; sm+ keeps the button alone on the right (its switcher
              leads the left rail). */}
          {isGust ? (
            <div className="col-span-2 mt-3 flex items-center justify-between sm:justify-end">
              <div className="sm:hidden">
                <ModeToggle disabled={isGroupMedia} isGust={isGust} />
              </div>
              {publishButton}
            </div>
          ) : null}
        </div>
      </div>

      {/* Capacity indicator: n/10 with context hints; turns warning near the
          cap and destructive at it. Gusts take a single video, so the counter
          is meaningless there and is hidden. */}
      {!isGust && !!attachments.length && (
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

      {isGust && hasVideoAttachment ? null : previewsBlock}
      {/* Post-mode alt text editor, directly under the attachment grid. */}
      {isGust ? null : (
        <AltTextEditorPanel
          altEditorKey={altEditorKey}
          attachments={attachments}
          onClose={() => setAltEditorKey(null)}
          onSave={setAltText}
        />
      )}
    </div>
  );
}

interface AttachmentPreviewsProps {
  attachments: Attachment[];
  cancelUpload: (fileName: string) => void;
  isGust: boolean;
  onAltEditRequest: (attachmentKey: string) => void;
  /** Gust only: tap the preview to swap the clip. */
  onChangeVideoRequest?: () => void;
  removeAttachment: (fileName: string) => void;
  reorderAttachments: (ordered: Attachment[]) => void;
  retryUpload: (fileName: string) => void;
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
  onChangeMediaClick,
  onEditAltClick,
  onRemoveClick,
  onRetryClick,
}: {
  attachment: Attachment;
  canReorder: boolean;
  index: number;
  isGust: boolean;
  onCancelClick: () => void;
  onChangeMediaClick?: () => void;
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
          onChangeMediaClick={onChangeMediaClick}
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
  onAltEditRequest,
  onChangeVideoRequest,
  removeAttachment,
  reorderAttachments,
  retryUpload,
}: AttachmentPreviewsProps) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Small movement threshold so taps on previews don't become drags.
      activationConstraint: { distance: 6 },
    })
  );

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
                  onChangeMediaClick={isGust ? onChangeVideoRequest : undefined}
                  onEditAltClick={() => onAltEditRequest(attachmentKey)}
                  onRemoveClick={handleRemoveClick(attachment)}
                  onRetryClick={handleRetryClick(attachment)}
                />
              </motion.div>
            );
          })}
        </motion.div>
      </SortableContext>
    </DndContext>
  );
};

// The shared alt text editor. Post mode: a transient panel under the
// attachment grid, opened from a tile. Gust mode: a compact panel docked
// under the caption input, always visible while a video is attached (the
// docked variant falls back to the sole gust attachment when no tile was
// tapped).
const AltTextEditorPanel = ({
  altDrafts,
  altEditorKey,
  attachments,
  onClose,
  onDraftChange,
  onSave,
  variant = "popover",
}: {
  altDrafts?: Record<string, string>;
  altEditorKey: string | null;
  attachments: Attachment[];
  onClose: () => void;
  onDraftChange?: (attachmentKey: string, draft: string) => void;
  onSave: (fileName: string, altText: string) => void;
  variant?: "docked" | "popover";
}) => {
  const docked = variant === "docked";
  const keyed = attachments.map((attachment, index) => ({
    attachment,
    key: attachmentKeyOf(attachment, index),
  }));
  const selected =
    keyed.find((entry) => entry.key === altEditorKey) ??
    (docked && keyed.length > 0 ? keyed[0] : undefined);
  return (
    <AnimatePresence>
      {selected ? (
        <motion.div
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          key={selected.key}
          transition={{ duration: 0.25, ease: "easeInOut" }}
        >
          {/* The height animation needs a clip, but focus rings and the
              premium-input glow draw OUTSIDE the border box - pad the clip
              so they have room, and cancel the padding with negative
              margins so spacing and width stay identical. The popover
              variant additionally pulls its top padding up so the bar sits
              flush under the attachment grid. */}
          <div
            className={cn(
              "-mx-1.5 -mb-1.5 overflow-hidden p-1.5",
              docked ? "mt-1.5" : "-mt-1.5"
            )}
          >
            <AltTextPanel
              attachment={selected.attachment}
              compact={docked}
              {...(docked
                ? {
                    draftValue: altDrafts?.[selected.key],
                    onDraftChange: (draft: string) =>
                      onDraftChange?.(selected.key, draft),
                  }
                : {})}
              onClose={onClose}
              onSave={onSave}
            />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
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
