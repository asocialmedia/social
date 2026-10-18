"use client";

import {
  formatViewOnceSeenAt,
  isViewOnceUnavailable,
  retryViewOnceReceipt,
  viewOnceReceiptKey,
} from "@asm/messages";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FileText, ImageOff, Loader2, X } from "lucide-react";
import Image from "next/image";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import {
  acknowledgeViewOnceSeen,
  closeViewOnceMedia,
  fetchViewOnceReceipt,
  openViewOnceMedia,
} from "@/lib/messages/client";
import type {
  MediaAttachmentRef,
  MediaImageRef,
  MessagePayload,
} from "@/lib/messages/crypto";
import { getMediaAttachments, getMediaImages } from "@/lib/messages/crypto";
import { cn } from "@/lib/utils";
import { getMessageMediaVariantUrl } from "@/lib/utils/image-url";

import { getAlbumLayout } from "./message-album-layout";
import {
  useOpenConversationMedia,
  useViewOnceConversationId,
} from "./message-media-viewer-context";

// Bento layouts for grouped albums live in message-album-layout.ts (pure, so
// the shapes are unit-tested). Each count from 2 to 10 has a bespoke layout;
// count 1 renders at its natural aspect ratio instead.
//
// The fullscreen experience is owned by the thread (see
// message-conversation-viewer.tsx): a tile just opens the conversation-wide
// viewer at its own image, so users can page through every image in the thread.

type LoadStatus = "error" | "loaded" | "loading";

function closeViewOnceSilently(
  conversationId: string,
  mediaId: string,
  grantId: string
): void {
  void (async () => {
    try {
      await closeViewOnceMedia(conversationId, mediaId, grantId);
    } catch {
      // The server expires abandoned grants if this best-effort close is offline.
    }
  })();
}

function ViewOncePhoto({
  canOpen,
  mediaId,
}: {
  canOpen: boolean;
  mediaId: string;
}) {
  const conversationId = useViewOnceConversationId();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const tileRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const receiptKey = viewOnceReceiptKey(
    user?.id ?? "",
    conversationId ?? "",
    mediaId
  );
  const receipt = useQuery({
    enabled: Boolean(user && conversationId && inView),
    gcTime: 60_000,
    queryFn: ({ signal }) =>
      fetchViewOnceReceipt(conversationId ?? "", mediaId, signal),
    queryKey: receiptKey,
    refetchInterval: (query) =>
      query.state.data?.seenAt ||
      query.state.data?.unavailable ||
      isViewOnceUnavailable(query.state.error)
        ? false
        : 15_000,
    retry: 1,
    staleTime: 15_000,
  });
  const acknowledge = useMutation({
    mutationFn: (grantId: string) =>
      acknowledgeViewOnceSeen(conversationId ?? "", mediaId, grantId),
    onSuccess: async (status) => {
      await queryClient.cancelQueries({ queryKey: receiptKey });
      queryClient.setQueryData(receiptKey, status);
    },
    retry: retryViewOnceReceipt,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });
  const seenLabel = formatViewOnceSeenAt(receipt.data?.seenAt);
  const receiptUnavailable =
    receipt.data?.unavailable || isViewOnceUnavailable(receipt.error);
  useEffect(() => {
    const tile = tileRef.current;
    if (!tile) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.3 }
    );
    observer.observe(tile);
    return () => observer.disconnect();
  }, []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [eyeMotionKey, setEyeMotionKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  const grantIdRef = useRef<string | null>(null);
  const acknowledgedGrant = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const closeViewer = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    const url = imageUrlRef.current;
    imageUrlRef.current = null;
    if (url) {
      URL.revokeObjectURL(url);
    }
    setImageUrl(null);
    setDialogOpen(false);
    setBusy(false);
    const grantId = grantIdRef.current;
    grantIdRef.current = null;
    if (grantId && conversationId) {
      closeViewOnceSilently(conversationId, mediaId, grantId);
    }
  }, [conversationId, mediaId]);

  useEffect(() => {
    if (!busy && !imageUrl) {
      return;
    }
    const hide = () => {
      if (document.visibilityState !== "visible") {
        closeViewer();
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", closeViewer);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", closeViewer);
    };
  }, [busy, closeViewer, imageUrl]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
      }
      const grantId = grantIdRef.current;
      if (grantId && conversationId) {
        closeViewOnceSilently(conversationId, mediaId, grantId);
      }
    },
    [conversationId, mediaId]
  );

  const openPhoto = useCallback(async () => {
    if (
      !canOpen ||
      !conversationId ||
      controllerRef.current ||
      busy ||
      receiptUnavailable ||
      opened ||
      unavailable
    ) {
      return;
    }
    const grantId = crypto.randomUUID();
    const controller = new AbortController();
    grantIdRef.current = grantId;
    controllerRef.current = controller;
    setBusy(true);
    setOpenError(null);
    try {
      const blob = await openViewOnceMedia(
        conversationId,
        mediaId,
        grantId,
        controller.signal
      );
      if (controller.signal.aborted || controllerRef.current !== controller) {
        closeViewOnceSilently(conversationId, mediaId, grantId);
        return;
      }
      const url = URL.createObjectURL(blob);
      imageUrlRef.current = url;
      setImageUrl(url);
      setOpened(true);
      setDialogOpen(true);
    } catch (error) {
      if (grantIdRef.current === grantId) {
        grantIdRef.current = null;
      }
      if (!controller.signal.aborted) {
        const status =
          typeof error === "object" && error !== null && "status" in error
            ? error.status
            : null;
        if (status === 410 || status === 404) {
          setUnavailable(true);
        } else {
          setOpenError("This photo couldn't be opened. Try again.");
        }
      }
      closeViewOnceSilently(conversationId, mediaId, grantId);
    }
    if (controllerRef.current === controller) {
      controllerRef.current = null;
      setBusy(false);
    }
  }, [
    busy,
    canOpen,
    conversationId,
    mediaId,
    opened,
    unavailable,
    receiptUnavailable,
  ]);

  let label = "Open photo";
  if (seenLabel) {
    label = seenLabel;
  } else if (opened) {
    label = "Opened";
  } else if (unavailable || receiptUnavailable) {
    label = "No longer available";
  }
  return (
    <>
      <div
        ref={tileRef}
        className={cn("view-once-tile", inView && "view-once-in-view")}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse" || event.pointerType === "pen") {
            setEyeMotionKey((current) => current + 1);
          }
        }}
      >
        {canOpen && conversationId ? (
          <button
            aria-label={label}
            className="surface-3d text-muted-foreground hover:bg-muted/70 flex min-h-16 w-full max-w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition-colors disabled:cursor-default"
            disabled={busy || opened || unavailable || receiptUnavailable}
            onClick={openPhoto}
            onFocus={() => setEyeMotionKey((current) => current + 1)}
            type="button"
          >
            <span className="bg-muted/70 flex size-10 shrink-0 items-center justify-center rounded-xl">
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Eye className="view-once-eye size-4" key={eyeMotionKey} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">
                {seenLabel || opened || unavailable || receiptUnavailable
                  ? label
                  : "View once photo"}
              </span>
              {openError ? (
                <span className="text-destructive mt-0.5 block text-xs">
                  {openError}
                </span>
              ) : null}
            </span>
            {!seenLabel &&
            !opened &&
            !unavailable &&
            !receiptUnavailable &&
            !busy ? (
              <span className="text-muted-foreground text-xs">Open</span>
            ) : null}
          </button>
        ) : (
          <div className="surface-3d text-muted-foreground flex min-h-16 w-full max-w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm">
            <span className="bg-muted/70 flex size-10 shrink-0 items-center justify-center rounded-xl">
              <Eye className="view-once-eye size-4" key={eyeMotionKey} />
            </span>
            <span>
              {seenLabel ??
                (receiptUnavailable
                  ? "No longer available"
                  : "View once photo")}
            </span>
          </div>
        )}
      </div>
      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeViewer();
          }
        }}
        open={dialogOpen}
      >
        <DialogContent
          className="max-h-[92vh] max-w-[min(92vw,1000px)] overflow-hidden border-0 bg-black p-2 text-white shadow-none sm:rounded-2xl"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">View once photo</DialogTitle>
          <DialogDescription className="sr-only">
            The photo closes when you dismiss the viewer.
          </DialogDescription>
          {imageUrl ? (
            <div className="relative h-[min(86vh,800px)] w-full">
              <Image
                alt=""
                className="rounded-xl object-contain"
                draggable={false}
                fill
                sizes="92vw"
                src={imageUrl}
                unoptimized
                onError={() => {
                  setOpenError("This photo couldn't be displayed.");
                  closeViewer();
                }}
                onLoad={() => {
                  const grantId = grantIdRef.current;
                  if (grantId && acknowledgedGrant.current !== grantId) {
                    acknowledgedGrant.current = grantId;
                    acknowledge.mutate(grantId);
                  }
                }}
              />
            </div>
          ) : null}
          <button
            aria-label="Close photo"
            className="icon-btn-3d absolute top-3 right-3 flex size-9 items-center justify-center rounded-full"
            onClick={closeViewer}
            type="button"
          >
            <X className="size-4" />
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function useMediaSource(image: MediaImageRef, kind: "gif" | "image") {
  const variant =
    kind === "image" ? getMessageMediaVariantUrl(image.url, image.width) : null;
  const [src, setSrc] = useState(variant ?? image.url);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [attempt, setAttempt] = useState(0);

  // One automatic fallback: optimized derivative -> original. A second failure
  // surfaces the retry affordance instead of an invisible box.
  const handleError = useCallback(() => {
    if (src !== image.url) {
      setSrc(image.url);
      return;
    }
    setStatus("error");
  }, [image.url, src]);

  const handleLoad = useCallback(() => {
    setStatus("loaded");
  }, []);

  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((value) => value + 1);
  }, []);

  return { attempt, handleError, handleLoad, retry, src, status };
}

// One bento cell. `object-cover` fills the assigned rectangle so mixed
// orientations tile cleanly; the uncropped image is available in the viewer.
function AlbumTile({
  image,
  index,
  kind,
  onClick,
  style,
  total,
}: {
  image: MediaImageRef;
  index: number;
  kind: "gif" | "image";
  onClick?: () => void;
  style: React.CSSProperties;
  total: number;
}) {
  const { attempt, handleError, handleLoad, retry, src, status } =
    useMediaSource(image, kind);

  // The tile is a plain container: the image and Retry are non-interactive, and
  // a dedicated overlay button opens the viewer. Nesting a Retry button inside
  // an outer open button would be invalid HTML (and unreachable for a11y tools).
  return (
    <div
      className="relative min-h-0 min-w-0 overflow-hidden bg-black/15"
      style={style}
    >
      {status === "loading" ? (
        <span className="bg-muted/60 absolute inset-0 animate-pulse" />
      ) : null}

      {status === "error" ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/20 px-1 text-center">
          <ImageOff className="text-muted-foreground h-4 w-4" />
          <button
            className="text-muted-foreground text-[10px] font-medium hover:underline"
            onClick={retry}
            type="button"
          >
            Retry
          </button>
        </span>
      ) : (
        <Image
          alt={kind === "gif" ? "GIF" : "Shared image"}
          className={cn(
            "object-cover transition-opacity duration-200",
            status === "loaded" ? "opacity-100" : "opacity-0"
          )}
          decoding="async"
          fill
          key={attempt}
          loading="lazy"
          onError={handleError}
          onLoad={handleLoad}
          sizes="(max-width: 640px) 80vw, 384px"
          src={src}
          // Session-gated media can't be fetched by the server-side Image
          // optimizer (no viewer cookies), so sources are pre-sized pipeline
          // derivatives instead.
          unoptimized
        />
      )}

      {status === "error" || !onClick ? null : (
        <button
          aria-label={`Open image ${index + 1} of ${total}`}
          className="absolute inset-0 z-10 outline-hidden focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-inset"
          onClick={onClick}
          type="button"
        />
      )}
    </div>
  );
}

// Bento collage for a grouped album. The grid's aspect ratio equals its
// column/row count, so every base cell is square and each tile is an exact
// rectangle of cells (see ALBUM_LAYOUTS). Senders can attach up to 10 images,
// and every count from 2 to 10 has a bespoke layout.
function AlbumGrid({
  images,
  kind,
  onOpen,
}: {
  images: MediaImageRef[];
  kind: "gif" | "image";
  onOpen?: (index: number) => void;
}) {
  const count = images.length;
  if (count === 1) {
    return (
      <SingleImage
        image={images[0]}
        kind={kind}
        onClick={onOpen ? () => onOpen(0) : undefined}
      />
    );
  }

  const layout = getAlbumLayout(count);
  const visible = images.slice(0, layout.placements.length);

  return (
    <div
      className="grid w-96 max-w-full min-w-0 gap-1 overflow-hidden rounded-2xl"
      style={{
        aspectRatio: `${layout.cols} / ${layout.rows}`,
        gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
      }}
    >
      {visible.map((image, index) => {
        const placement = layout.placements[index];
        return (
          <AlbumTile
            image={image}
            index={index}
            key={`${index}-${image.url}`}
            kind={kind}
            onClick={onOpen ? () => onOpen(index) : undefined}
            style={{
              gridColumn: `${placement.col + 1} / span ${placement.colSpan}`,
              gridRow: `${placement.row + 1} / span ${placement.rowSpan}`,
            }}
            total={count}
          />
        );
      })}
    </div>
  );
}

// Single image keeps the original aspect-ratio box (object-contain) so nothing
// is cropped when a message has just one attachment.
function SingleImage({
  image,
  kind,
  onClick,
}: {
  image: MediaImageRef;
  kind: "gif" | "image";
  onClick?: () => void;
}) {
  const { attempt, handleError, handleLoad, retry, src, status } =
    useMediaSource(image, kind);
  const aspectRatio =
    image.width && image.height ? `${image.width} / ${image.height}` : "4 / 3";

  return (
    <div
      className="relative w-96 max-w-full min-w-0 overflow-hidden rounded-2xl bg-black/15 text-left"
      style={{ aspectRatio }}
    >
      {status === "loading" ? (
        <span className="bg-muted/60 absolute inset-0 animate-pulse" />
      ) : null}
      {status === "error" ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
          <ImageOff className="text-muted-foreground h-5 w-5" />
          <span className="text-muted-foreground text-xs">
            Couldn&apos;t load image
          </span>
          <button
            className="text-primary text-xs font-medium hover:underline"
            onClick={retry}
            type="button"
          >
            Retry
          </button>
        </span>
      ) : (
        <Image
          alt={kind === "gif" ? "GIF" : "Shared image"}
          className={cn(
            "object-contain transition-opacity duration-200",
            status === "loaded" ? "opacity-100" : "opacity-0"
          )}
          decoding="async"
          fill
          key={attempt}
          loading="lazy"
          onError={handleError}
          onLoad={handleLoad}
          sizes="(max-width: 640px) 80vw, 384px"
          src={src}
          unoptimized
        />
      )}
      {status === "error" || !onClick ? null : (
        <button
          aria-label={kind === "gif" ? "Open GIF" : "Open image"}
          className="absolute inset-0 z-10 rounded-[inherit] outline-hidden focus-visible:ring-2 focus-visible:ring-white/80"
          onClick={onClick}
          type="button"
        />
      )}
    </div>
  );
}

// One row carries one kind for the grid. Version-2 photos report their own
// kinds, so a row that holds any GIF renders its GIF tiles as animated.
function rowMediaKind(
  content: Extract<MessagePayload, { type: "media" }>
): "gif" | "image" {
  if (!("attachments" in content)) {
    return content.kind;
  }
  return content.attachments.some((attachment) => attachment.kind === "gif")
    ? "gif"
    : "image";
}

export function MessageMediaAlbum({
  content,
  mine,
  messageId,
}: {
  content: Extract<MessagePayload, { type: "media" }>;
  mine: boolean;
  messageId: string;
}) {
  const images = getMediaImages(content);
  const attachments = getMediaAttachments(content);
  const kind = rowMediaKind(content);
  const openConversationMedia = useOpenConversationMedia();
  const caption = content.content?.trim();
  const mixedPhotoKinds =
    attachments.some((attachment) => attachment.kind === "image") &&
    attachments.some((attachment) => attachment.kind === "gif");

  const handleOpen = useCallback(
    (imageIndex: number) => {
      openConversationMedia?.({ imageIndex, messageId });
    },
    [messageId, openConversationMedia]
  );

  if (
    mixedPhotoKinds ||
    attachments.some((attachment) =>
      ["file", "video", "view-once"].includes(attachment.kind)
    )
  ) {
    const singleViewOnce =
      attachments.length === 1 && attachments[0]?.kind === "view-once";
    return (
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2",
          singleViewOnce ? "w-72 max-w-full" : "w-96 max-w-full"
        )}
      >
        {attachments.map((attachment, index) => {
          if (attachment.kind === "image" || attachment.kind === "gif") {
            const currentImageIndex = attachments
              .slice(0, index)
              .filter(
                (previous) =>
                  previous.kind === "image" || previous.kind === "gif"
              ).length;
            return (
              <SingleImage
                image={attachment}
                key={`${attachment.url}-${index}`}
                kind={attachment.kind}
                onClick={
                  openConversationMedia
                    ? () => handleOpen(currentImageIndex)
                    : undefined
                }
              />
            );
          }
          if (attachment.kind === "video") {
            return (
              <VideoAttachment attachment={attachment} key={attachment.url} />
            );
          }
          if (attachment.kind === "file") {
            return (
              <FileAttachment attachment={attachment} key={attachment.url} />
            );
          }
          if (attachment.kind === "view-once") {
            return (
              <ViewOncePhoto
                canOpen={!mine}
                key={`view-once-${attachment.ref}`}
                mediaId={attachment.ref}
              />
            );
          }
          return null;
        })}
        {caption ? (
          <p className="min-w-0 px-0.5 text-sm break-words whitespace-pre-wrap">
            {caption}
          </p>
        ) : null}
      </div>
    );
  }
  if (images.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <AlbumGrid
        images={images}
        kind={kind}
        // Without the thread's viewer provider the grid is display-only, so a
        // tile can never be an interactive dead button.
        onOpen={openConversationMedia ? handleOpen : undefined}
      />
      {caption ? (
        <p className="min-w-0 px-0.5 text-sm break-words whitespace-pre-wrap">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

function mediaIdFromUrl(url: string): string | null {
  return (
    /^\/api\/media\/(?<id>[A-Za-z0-9_-]+)(?:\/|$)/u.exec(url)?.groups?.id ??
    null
  );
}

function formatAttachmentSize(bytes?: number): string {
  if (!bytes || bytes < 0) {
    return "File";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function VideoAttachment({
  attachment,
}: {
  attachment: Extract<MediaAttachmentRef, { kind: "video" }>;
}) {
  return (
    <video
      aria-label="Shared video"
      className="max-h-80 w-full rounded-2xl bg-black object-contain"
      controls
      playsInline
      preload="metadata"
      src={attachment.url}
    >
      <track
        default
        kind="captions"
        label="English"
        src={`${attachment.url}?captions=1`}
        srcLang="en"
      />
    </video>
  );
}

function FileAttachment({
  attachment,
}: {
  attachment: Extract<MediaAttachmentRef, { kind: "file" }>;
}) {
  if (attachment.mimeType?.startsWith("audio/")) {
    return (
      <audio
        aria-label={attachment.filename}
        className="w-full"
        controls
        preload="none"
        src={attachment.url}
      >
        <track
          default
          kind="captions"
          label="English"
          src={`${attachment.url}?captions=1`}
          srcLang="en"
        />
      </audio>
    );
  }
  const mediaId = mediaIdFromUrl(attachment.url);
  if (!mediaId) {
    return null;
  }
  return (
    <a
      className="surface-3d hover:bg-muted/50 flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors"
      download={attachment.filename}
      href={`/api/media/download/${mediaId}`}
    >
      <span className="bg-muted/70 flex size-10 shrink-0 items-center justify-center rounded-xl">
        <FileText className="text-muted-foreground size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {attachment.filename}
        </span>
        <span className="text-muted-foreground block text-xs">
          {formatAttachmentSize(attachment.bytes)}
        </span>
      </span>
      <Download
        aria-hidden="true"
        className="text-muted-foreground size-4 shrink-0"
      />
    </a>
  );
}
