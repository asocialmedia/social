import type { Media, PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { FileAudioIcon, FileCode, FileIcon, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MdPlayArrow } from "react-icons/md";
import { useMediaQuery } from "usehooks-ts";
import { getLanguageFromFileName } from "@/lib/codefile-extensions";
import { formatFileName } from "@/lib/format-file-name";
import { cn } from "@/lib/utils";
import MediaViewer from "./media-viewer";

interface MediaPreviewsProps {
  attachments: Media[];
  autoPlayVideos?: boolean;
  initialMediaIndex?: number;
  interactive?: boolean;
  post?: PostData;
}

// Top-level component (not nested) so its own hover/play state doesn't cause
// the parent grid to re-render and remount the <video> element mid-playback.
const VIDEO_HOVER_DELAY = 350;

function VideoPreview({
  autoPlay = false,
  isSmall,
  media,
}: {
  autoPlay?: boolean;
  isSmall: boolean;
  media: Media;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveredRef = useRef(false);
  const previewStartedRef = useRef(false);
  const [expandedHeight, setExpandedHeight] = useState<number | null>(null);

  const getMediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

  const getExpandedHeight = useCallback((): number | null => {
    const container = containerRef.current;
    const video = container?.querySelector("video");
    if (container && video && video.videoWidth > 0 && video.videoHeight > 0) {
      const naturalHeight =
        (container.clientWidth * video.videoHeight) / video.videoWidth;
      return Math.min(naturalHeight, window.innerHeight * 0.75);
    }
    return null;
  }, []);

  const startPreview = useCallback(() => {
    previewStartedRef.current = true;
    const video = containerRef.current?.querySelector("video");
    if (video) {
      video.play().catch(() => undefined);
    }
    const height = getExpandedHeight();
    if (height !== null) {
      setExpandedHeight(height);
    }
  }, [getExpandedHeight]);

  const handleMouseEnter = useCallback(() => {
    if (autoPlay) {
      return;
    }
    isHoveredRef.current = true;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      startPreview();
    }, VIDEO_HOVER_DELAY);
  }, [autoPlay, startPreview]);

  const handleMouseLeave = useCallback(() => {
    if (autoPlay) {
      return;
    }
    isHoveredRef.current = false;
    previewStartedRef.current = false;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    const video = containerRef.current?.querySelector("video");
    if (video) {
      video.pause();
      if (video.duration > 2) {
        video.currentTime = 2;
      }
    }
    setExpandedHeight(null);
  }, [autoPlay]);

  // Seek past the first frame so the preview shows a meaningful thumbnail
  // (hover mode only - in autoplay mode the video starts from the beginning),
  // and expand if the preview already started before this video's metadata
  // loaded.
  const handleLoadedMetadata = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      if (!autoPlay && video.duration > 2) {
        video.currentTime = 2;
      }
      if (previewStartedRef.current) {
        const height = getExpandedHeight();
        if (height !== null) {
          setExpandedHeight(height);
        }
        if (autoPlay) {
          video.play().catch(() => undefined);
        }
      }
    },
    [autoPlay, getExpandedHeight]
  );

  // Clear any pending hover timer on unmount
  useEffect(
    () => () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    },
    []
  );

  // Autoplay mode (post detail page): expand to the natural height and start
  // playing as soon as the video metadata is available.
  useEffect(() => {
    if (autoPlay) {
      startPreview();
    }
  }, [autoPlay, startPreview]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Video preview needs mouse interactions for hover autoplay
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Video preview needs mouse interactions for hover autoplay
    <div
      className={cn(
        "group relative w-full overflow-hidden transition-[height] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
        isSmall ? "h-20" : "h-56"
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      ref={containerRef}
      style={expandedHeight === null ? undefined : { height: expandedHeight }}
    >
      {/* absolute fill crops the video to the preview box while collapsed, but matches the expanded height when hovering */}
      <video
        className="absolute inset-0 h-full w-full rounded-lg object-cover"
        muted
        onLoadedMetadata={handleLoadedMetadata}
        playsInline
        preload="metadata"
        src={getMediaUrl(media.id)}
      />
      <div
        className={cn(
          "absolute top-2 right-2 transition-opacity duration-300",
          expandedHeight === null ? "opacity-100" : "opacity-0"
        )}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
          <MdPlayArrow className="ml-0.5 h-3.5 w-3.5 text-white" />
        </div>
      </div>
      <div
        className={cn(
          "absolute bottom-2 left-2 flex h-7 items-center gap-1.5 rounded-full bg-black/50 px-2 text-white backdrop-blur-md transition-opacity duration-300",
          autoPlay ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
        role="status"
      >
        <VolumeX className="h-3.5 w-3.5" />
        <span className="font-medium text-xs">Muted</span>
      </div>
      <div className="absolute inset-0 bg-linear-to-t from-black/50 via-transparent to-transparent opacity-40 transition-all duration-300 group-hover:opacity-20" />
    </div>
  );
}

export function MediaPreviews({
  attachments,
  autoPlayVideos = false,
  interactive = true,
  post,
  initialMediaIndex,
}: MediaPreviewsProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    initialMediaIndex ?? null
  );
  const [showAll, setShowAll] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");

  // When a post is present the viewer lives at a shareable route
  // (/posts/{postId}/media/{index}); otherwise (e.g. profile gallery) it is
  // driven by local state only.
  const router = useRouter();

  const getMediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

  const handleShowAll = useCallback(() => {
    setShowAll(true);
  }, []);

  const handleShowLess = useCallback(() => {
    setShowAll(false);
  }, []);

  const handleCloseViewer = useCallback(() => {
    if (post) {
      // Replace (not push) so closing the viewer returns to the post page
      // without leaving a stale media URL in the history that pressing Back
      // would reopen.
      router.replace(`/posts/${post.id}`);
      return;
    }
    setSelectedIndex(null);
  }, [post, router]);

  const openAtIndex = useCallback(
    (index: number) => {
      if (post) {
        router.push(`/posts/${post.id}/media/${index}`);
        return;
      }
      setSelectedIndex(index);
    },
    [post, router]
  );

  const handleNavigateIndex = useCallback(
    (index: number) => {
      if (post) {
        // Update the URL in place so the shared link tracks the viewed asset.
        router.replace(`/posts/${post.id}/media/${index}`);
        return;
      }
      setSelectedIndex(index);
    },
    [post, router]
  );

  const initialCount = isMobile ? 2 : 3;
  const visibleAttachments =
    !interactive || showAll ? attachments : attachments.slice(0, initialCount);
  const remainingAttachments = attachments.slice(initialCount);
  const remainingCount = attachments.length - initialCount;

  const getCommonClasses = (isSmall: boolean) =>
    cn(
      "mx-auto w-full rounded-lg object-cover transition-transform duration-300 group-hover:scale-105",
      isSmall ? "h-20" : "h-56"
    );

  const renderImagePreview = (m: Media, isSmall: boolean) => {
    if (m.mimeType === "image/svg+xml") {
      return (
        <div className={cn("group relative w-full", isSmall ? "h-20" : "h-56")}>
          <object
            className={getCommonClasses(isSmall)}
            data={getMediaUrl(m.id)}
            type="image/svg+xml"
          >
            Your browser does not support SVG
          </object>
          <div className="absolute inset-0 bg-black/5 transition-opacity group-hover:opacity-0" />
        </div>
      );
    }

    return (
      <div className={cn("group relative w-full", isSmall ? "h-20" : "h-56")}>
        <Image
          alt="Attachment"
          className={getCommonClasses(isSmall)}
          fill
          src={getMediaUrl(m.id)}
          style={{ objectFit: "cover" }}
        />
        <div className="absolute inset-0 bg-black/5 transition-opacity group-hover:opacity-0" />
      </div>
    );
  };

  const renderFilePreview = (
    m: Media,
    isSmall: boolean,
    icon: React.ReactNode
  ) => (
    <div className={cn("group relative w-full", isSmall ? "h-20" : "h-56")}>
      <div className="h-full w-full rounded-lg bg-primary/5 p-4 transition-transform duration-300 group-hover:scale-105">
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <div
            className={cn("text-primary", isSmall ? "h-6 w-6" : "h-12 w-12")}
          >
            {icon}
          </div>
          {!isSmall && (
            <p className="max-w-full truncate font-medium text-sm">
              {formatFileName(m.key)}
            </p>
          )}
        </div>
      </div>
    </div>
  );

  const renderCodePreview = (m: Media, isSmall: boolean) => (
    <div className={cn("group relative w-full", isSmall ? "h-20" : "h-56")}>
      <div className="h-full w-full rounded-lg bg-primary/5 p-4 transition-transform duration-300 group-hover:scale-105">
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <FileCode
            className={cn("text-primary", isSmall ? "h-6 w-6" : "h-12 w-12")}
          />
          {!isSmall && (
            <div className="flex flex-col items-center">
              <p className="max-w-full truncate font-medium text-sm">
                {formatFileName(m.key)}
              </p>
              <p className="text-muted-foreground text-xs">
                {getLanguageFromFileName(m.key)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderPreview = (m: Media, _index: number, isSmall = false) => {
    switch (m.type) {
      case "IMAGE":
        return renderImagePreview(m, isSmall);
      case "VIDEO":
        return (
          <VideoPreview autoPlay={autoPlayVideos} isSmall={isSmall} media={m} />
        );
      case "AUDIO":
        return renderFilePreview(m, isSmall, <FileAudioIcon />);
      case "CODE":
        return renderCodePreview(m, isSmall);
      case "DOCUMENT":
        return renderFilePreview(m, isSmall, <FileIcon />);
      default:
        return null;
    }
  };

  const handleSelectImage = useCallback(
    (index: number) => () => openAtIndex(index),
    [openAtIndex]
  );

  // biome-ignore lint/correctness/noNestedComponentDefinitions: SingleImagePreview needs parent state and hooks, making it reasonable to keep nested
  const SingleImagePreview = ({
    media,
    onSelect,
  }: {
    media: Media;
    onSelect: () => void;
  }) => {
    const storedW = typeof media.width === "number" ? media.width : null;
    const storedH = typeof media.height === "number" ? media.height : null;
    const hasStoredDims = storedW !== null && storedH !== null;
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(
      hasStoredDims ? { w: storedW, h: storedH } : null
    );

    useEffect(() => {
      if (hasStoredDims) {
        return;
      }
      if (natural) {
        return;
      }
      const img = new window.Image();
      img.onload = () => {
        if (img.naturalWidth > 0) {
          setNatural({ w: img.naturalWidth, h: img.naturalHeight });
        }
      };
      img.src = getMediaUrl(media.id);
      return () => {
        img.onload = null;
      };
    }, [media.id, natural, hasStoredDims]);

    const dims = natural;

    return interactive ? (
      <button
        aria-label="View attachment"
        className="block w-full cursor-pointer text-left"
        onClick={onSelect}
        type="button"
      >
        {dims ? (
          <div className="relative inline-block max-w-full overflow-hidden rounded-lg shadow-xs transition-all duration-300 hover:shadow-md">
            <Image
              alt="Attachment"
              className="!relative !h-auto max-h-[480px] w-auto max-w-full rounded-lg object-cover"
              height={dims.h}
              src={getMediaUrl(media.id)}
              style={{ objectFit: "cover" }}
              width={dims.w}
            />
          </div>
        ) : (
          <div className="relative aspect-video w-full overflow-hidden rounded-lg shadow-xs transition-all duration-300 hover:shadow-md">
            <Image
              alt="Attachment"
              className="object-cover"
              fill
              src={getMediaUrl(media.id)}
              style={{ objectFit: "cover" }}
            />
            <div className="absolute inset-0 bg-black/5 transition-opacity group-hover:opacity-0" />
          </div>
        )}
      </button>
    ) : (
      <div>
        {dims ? (
          <div className="relative inline-block max-w-full overflow-hidden rounded-lg shadow-xs">
            <Image
              alt="Attachment"
              className="!relative !h-auto max-h-120 w-auto max-w-full rounded-lg object-cover"
              height={dims.h}
              src={getMediaUrl(media.id)}
              style={{ objectFit: "cover" }}
              width={dims.w}
            />
          </div>
        ) : (
          <div className="relative aspect-video w-full overflow-hidden rounded-lg shadow-xs">
            <Image
              alt="Attachment"
              className="object-cover"
              fill
              src={getMediaUrl(media.id)}
              style={{ objectFit: "cover" }}
            />
          </div>
        )}
      </div>
    );
  };

  // biome-ignore lint/correctness/noNestedComponentDefinitions: GridPreview uses parent component props and state, making it reasonable to keep nested
  const GridPreview = ({
    media,
    index,
    size = "large",
  }: {
    media: Media;
    index: number;
    size?: "small" | "large";
  }) => {
    const isSmall = size === "small";
    // Videos size themselves (collapsed preview + hover expansion), so let the wrapper grow with them
    let wrapperHeightClass = "h-56";
    if (isSmall) {
      wrapperHeightClass = "h-20";
    }
    if (media.type === "VIDEO") {
      wrapperHeightClass = "h-auto";
    }

    // openAtIndex is a stable useCallback from the parent scope, so index is
    // the only value that can change between renders of this row.
    const handleSelect = useCallback(() => {
      openAtIndex(index);
    }, [index]);

    return interactive ? (
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        aria-label="View attachment"
        className={cn(
          "relative cursor-pointer overflow-hidden rounded-lg shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md",
          wrapperHeightClass
        )}
        data-card-interactive
        exit={{ opacity: 0, y: -20 }}
        initial={{ opacity: 0, y: 20 }}
        layout
        onClick={handleSelect}
        role="button"
        tabIndex={0}
        transition={{ duration: 0.2, delay: index * 0.05 }}
      >
        {renderPreview(media, index, isSmall)}
      </motion.div>
    ) : (
      <div
        className={cn(
          "relative overflow-hidden rounded-lg shadow-xs",
          wrapperHeightClass
        )}
      >
        {renderPreview(media, index, isSmall)}
      </div>
    );
  };

  // biome-ignore lint/correctness/noNestedComponentDefinitions: ShowMoreSection uses parent component state, making it reasonable to keep nested
  const ShowMoreSection = () => {
    if (isMobile) {
      return (
        <motion.div
          animate={{ opacity: 1 }}
          className="px-4 pb-4"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          layout
        >
          <div className="relative w-full overflow-hidden rounded-lg bg-primary/5 p-4 shadow-xs transition-all duration-300">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">
                  {remainingCount} more items
                </p>
                <Button onClick={handleShowAll} size="sm" variant="secondary">
                  Show All
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {remainingAttachments.map((m, index) => (
                  <GridPreview
                    index={index + initialCount}
                    key={m.id}
                    media={m}
                    size="small"
                  />
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div
        animate={{ opacity: 1 }}
        className="px-4 pb-4"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0 }}
        layout
      >
        <button
          aria-label="Show all media"
          className="relative w-full cursor-pointer overflow-hidden rounded-lg bg-primary/5 shadow-xs transition-all duration-300 hover:bg-primary/10 hover:shadow-md"
          onClick={handleShowAll}
          type="button"
        >
          <div className="flex h-32 items-center justify-between p-4">
            <div className="flex items-center gap-4">
              {remainingAttachments.slice(0, 2).map((m, index) => (
                <motion.div
                  animate={{ opacity: 1, x: 0 }}
                  className="relative h-24 w-24 overflow-hidden rounded-lg"
                  initial={{ opacity: 0, x: -20 }}
                  key={m.id}
                  transition={{ delay: index * 0.1 }}
                >
                  {renderPreview(m, index + initialCount)}
                  <div className="absolute inset-0 bg-black/10" />
                </motion.div>
              ))}
            </div>

            <motion.div
              animate={{ opacity: 1 }}
              className="flex flex-col items-end gap-2 pr-4"
              initial={{ opacity: 0 }}
            >
              <p className="font-medium text-lg">Show {remainingCount} more</p>
              <Button variant="secondary">Expand</Button>
            </motion.div>
          </div>
        </button>
      </motion.div>
    );
  };

  return (
    <motion.div className="w-full" layout>
      <div
        className={cn(
          "grid gap-4",
          (() => {
            if (visibleAttachments.length === 1) {
              return "grid-cols-1";
            }
            if (isMobile) {
              return "grid-cols-2";
            }
            if (visibleAttachments.length === 2) {
              return "grid-cols-2";
            }
            return "grid-cols-3";
          })()
        )}
      >
        <AnimatePresence mode="wait">
          {visibleAttachments.map((m, index) =>
            visibleAttachments.length === 1 &&
            m.type === "IMAGE" &&
            m.mimeType !== "image/svg+xml" ? (
              <SingleImagePreview
                key={m.id}
                media={m}
                onSelect={handleSelectImage(index)}
              />
            ) : (
              <GridPreview index={index} key={m.id} media={m} />
            )
          )}
        </AnimatePresence>
      </div>

      {interactive && !showAll && attachments.length > initialCount && (
        <ShowMoreSection />
      )}

      <AnimatePresence>
        {interactive && showAll ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="flex justify-center pb-4"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
          >
            <Button
              onClick={handleShowLess}
              size={isMobile ? "sm" : "default"}
              variant="ghost"
            >
              Show Less
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {interactive && selectedIndex !== null && (
        <MediaViewer
          initialIndex={selectedIndex}
          isOpen={selectedIndex !== null}
          media={attachments}
          onClose={handleCloseViewer}
          onNavigate={handleNavigateIndex}
          post={post}
        />
      )}
    </motion.div>
  );
}
