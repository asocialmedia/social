// oxlint-disable react-compiler -- nested preview components (SingleImagePreview/GridPreview/ShowMoreSection) need hooks and parent state, which the React Compiler rules reject

import type { Media, PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  FileAudioIcon,
  FileCode,
  FileIcon,
  ImageOff,
  VolumeX,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MdPlayArrow } from "react-icons/md";
import { useMediaQuery } from "usehooks-ts";

import { getLanguageFromFileName } from "@/lib/codefile-extensions";
import { formatFileName } from "@/lib/format-file-name";
import { cn } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

// eslint-disable-next-line import/no-cycle -- media-previews renders inside post-card while the media viewer shows related posts via post-card
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

const getMediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

const getCommonClasses = (isSmall: boolean) =>
  cn(
    "mx-auto w-full rounded-lg object-cover transition-transform duration-300 group-hover:scale-105",
    isSmall ? "h-20" : "h-56"
  );

const GridImagePreview = ({
  isSmall,
  media,
}: {
  isSmall: boolean;
  media: Media;
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isFailed, setIsFailed] = useState(false);

  if (isFailed) {
    return (
      <div
        className={cn(
          "group border-border/60 bg-muted/20 text-muted-foreground relative flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-2 text-center text-xs",
          isSmall ? "h-20" : "h-56"
        )}
      >
        <ImageOff className="h-5 w-5 opacity-60" />
        <span className="text-[10px]">Failed to load</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group bg-muted/20 relative w-full overflow-hidden rounded-lg",
        isSmall ? "h-20" : "h-56"
      )}
    >
      {isLoading ? (
        <div className="bg-muted/40 absolute inset-0 animate-pulse" />
      ) : null}
      <Image
        alt="Attachment"
        className={cn(
          getCommonClasses(isSmall),
          "transition-opacity duration-300",
          isLoading ? "opacity-0" : "opacity-100"
        )}
        fill
        onError={() => {
          setIsFailed(true);
          setIsLoading(false);
        }}
        onLoad={() => setIsLoading(false)}
        // Mobile grid is 2 columns, desktop is 3; match the rendered column
        // width so the browser picks an appropriately-sized image.
        sizes="(max-width: 768px) 50vw, 33vw"
        src={getMediaUrl(media.id)}
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
    <div className="bg-primary/5 h-full w-full rounded-lg p-4 transition-transform duration-300 group-hover:scale-105">
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <div className={cn("text-primary", isSmall ? "h-6 w-6" : "h-12 w-12")}>
          {icon}
        </div>
        {!isSmall && (
          <p className="max-w-full truncate text-sm font-medium">
            {formatFileName(m.key)}
          </p>
        )}
      </div>
    </div>
  </div>
);

const renderCodePreview = (m: Media, isSmall: boolean) => (
  <div className={cn("group relative w-full", isSmall ? "h-20" : "h-56")}>
    <div className="bg-primary/5 h-full w-full rounded-lg p-4 transition-transform duration-300 group-hover:scale-105">
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <FileCode
          className={cn("text-primary", isSmall ? "h-6 w-6" : "h-12 w-12")}
        />
        {!isSmall && (
          <div className="flex flex-col items-center">
            <p className="max-w-full truncate text-sm font-medium">
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

const VideoPreview = ({
  autoPlay = false,
  isSmall,
  media,
}: {
  autoPlay?: boolean;
  isSmall: boolean;
  media: Media;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveredRef = useRef(false);
  const previewStartedRef = useRef(false);
  const [expandedHeight, setExpandedHeight] = useState<number | null>(null);
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

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
      void (async () => {
        try {
          await video.play();
        } catch {
          // Autoplay may be blocked or aborted by user navigation; ignore safely
        }
      })();
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
    setIsHovered(true);
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
    setIsHovered(false);
    isHoveredRef.current = false;
    previewStartedRef.current = false;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    const video = containerRef.current?.querySelector("video");
    if (video) {
      try {
        video.pause();
        if (video.readyState >= 1 && video.duration > 2) {
          video.currentTime = 2;
        }
      } catch {
        // Ignore pause/seek aborts
      }
    }
    setExpandedHeight(null);
    setIsVideoActive(false);
  }, [autoPlay]);

  // Fade the thumbnail overlay out only once playback actually starts so the
  // poster-to-video switch is a smooth crossfade instead of an instant swap.
  const handlePlaying = useCallback(() => {
    setIsVideoActive(true);
  }, []);

  // Seek past the first frame so the preview shows a meaningful thumbnail
  // (hover mode only - in autoplay mode the video starts from the beginning),
  // and expand if the preview already started before this video's metadata
  // loaded.
  const handleLoadedMetadata = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      if (!autoPlay && video.duration > 2) {
        try {
          video.currentTime = 2;
        } catch {
          // Ignore seek aborts
        }
      }
      if (previewStartedRef.current) {
        const height = getExpandedHeight();
        if (height !== null) {
          setExpandedHeight(height);
        }
        if (autoPlay) {
          void (async () => {
            try {
              await video.play();
            } catch {
              // Autoplay may be blocked or aborted; ignore
            }
          })();
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
      {
        // absolute fill crops the video to the preview box while collapsed, but matches the expanded height when hovering
      }
      <video
        className="absolute inset-0 h-full w-full rounded-lg object-cover"
        muted
        onLoadedMetadata={handleLoadedMetadata}
        onPlaying={handlePlaying}
        playsInline
        preload={autoPlay ? "metadata" : "none"}
        src={isHovered || autoPlay ? getMediaUrl(media.id) : undefined}
      />
      {/* Thumbnail overlay crossfades out once playback actually starts */}
      <Image
        alt="Video preview"
        className={cn(
          "absolute inset-0 h-full w-full rounded-lg object-cover transition-opacity duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
          isVideoActive ? "opacity-0" : "opacity-100"
        )}
        fill
        sizes="(max-width: 768px) 50vw, 33vw"
        src={getMediaProxyUrl(media)}
        unoptimized
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
        role="status" // eslint-disable-line jsx-a11y/prefer-tag-over-role -- status badge overlaid on the video
      >
        <VolumeX className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">Muted</span>
      </div>
      <div className="absolute inset-0 bg-linear-to-t from-black/50 via-transparent to-transparent opacity-40 transition-all duration-300 group-hover:opacity-20" />
    </div>
  );
};

export const MediaPreviews = ({
  attachments,
  autoPlayVideos = false,
  interactive = true,
  post,
  initialMediaIndex,
}: MediaPreviewsProps) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    initialMediaIndex ?? null
  );
  const [showAll, setShowAll] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");

  // When a post is present the viewer lives at a shareable route
  // (/posts/{postId}/media/{index}); otherwise (e.g. profile gallery) it is
  // driven by local state only.
  const router = useRouter();

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

    return <GridImagePreview isSmall={isSmall} media={m} />;
  };

  const renderPreview = (m: Media, _index: number, isSmall = false) => {
    switch (m.type) {
      case "IMAGE": {
        return renderImagePreview(m, isSmall);
      }
      case "VIDEO": {
        return (
          <VideoPreview autoPlay={autoPlayVideos} isSmall={isSmall} media={m} />
        );
      }
      case "AUDIO": {
        return renderFilePreview(m, isSmall, <FileAudioIcon />);
      }
      case "CODE": {
        return renderCodePreview(m, isSmall);
      }
      case "DOCUMENT": {
        return renderFilePreview(m, isSmall, <FileIcon />);
      }
      default: {
        return null;
      }
    }
  };

  const handleSelectImage = useCallback(
    (index: number) => () => openAtIndex(index),
    [openAtIndex]
  );

  // eslint-disable-next-line react/no-unstable-nested-components -- SingleImagePreview needs parent state and hooks, making it reasonable to keep nested
  const SingleImagePreview = ({
    media,
    onSelect,
  }: {
    media: Media;
    onSelect: () => void;
  }) => {
    const storedW =
      typeof media.width === "number" && media.width > 0 ? media.width : null;
    const storedH =
      typeof media.height === "number" && media.height > 0
        ? media.height
        : null;
    const hasStoredDims = storedW !== null && storedH !== null;
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(
      hasStoredDims ? { h: storedH, w: storedW } : null
    );
    const [isLoading, setIsLoading] = useState(true);
    const [isFailed, setIsFailed] = useState(false);

    useEffect(() => {
      if (hasStoredDims) {
        return;
      }
      if (natural) {
        return;
      }
      const img = new window.Image();
      const handleLoad = () => {
        if (img.naturalWidth > 0) {
          setNatural({ h: img.naturalHeight, w: img.naturalWidth });
        }
      };
      img.addEventListener("load", handleLoad);
      img.src = getMediaUrl(media.id);
      return () => {
        img.removeEventListener("load", handleLoad);
      };
    }, [media.id, natural, hasStoredDims]);

    const dims = natural;

    if (isFailed) {
      return (
        <div className="border-border/60 bg-muted/20 text-muted-foreground flex max-h-[500px] w-full items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-sm">
          <ImageOff className="h-5 w-5 opacity-60" />
          <span>Attachment failed to load</span>
        </div>
      );
    }

    const previewContent = (
      <div className="bg-muted/20 relative inline-block max-w-full overflow-hidden rounded-xl shadow-xs transition-shadow duration-300 hover:shadow-md">
        {isLoading ? (
          <div className="bg-muted/40 absolute inset-0 animate-pulse" />
        ) : null}
        <Image
          alt="Attachment"
          className={cn(
            "h-auto max-h-[500px] w-auto max-w-full rounded-xl object-contain transition-opacity duration-300",
            isLoading ? "opacity-0" : "opacity-100"
          )}
          height={dims?.h ?? 480}
          onError={() => {
            setIsFailed(true);
            setIsLoading(false);
          }}
          onLoad={() => setIsLoading(false)}
          sizes="(max-width: 768px) 100vw, 640px"
          src={getMediaUrl(media.id)}
          style={
            dims
              ? {
                  aspectRatio: `${dims.w} / ${dims.h}`,
                  maxHeight: "500px",
                }
              : { maxHeight: "500px" }
          }
          width={dims?.w ?? 640}
        />
      </div>
    );

    return interactive ? (
      <button
        aria-label="View attachment"
        className="block w-full cursor-pointer text-left"
        onClick={onSelect}
        type="button"
      >
        {previewContent}
      </button>
    ) : (
      <div>{previewContent}</div>
    );
  };

  // eslint-disable-next-line react/no-unstable-nested-components -- GridPreview uses parent component props and state, making it reasonable to keep nested
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
      <button
        aria-label="View attachment"
        className={cn(
          "relative block w-full cursor-pointer overflow-hidden rounded-lg p-0 text-left shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md",
          wrapperHeightClass
        )}
        data-card-interactive
        onClick={handleSelect}
        type="button"
      >
        {renderPreview(media, index, isSmall)}
      </button>
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

  // eslint-disable-next-line react/no-unstable-nested-components -- ShowMoreSection uses parent component state, making it reasonable to keep nested
  const ShowMoreSection = () => {
    if (isMobile) {
      return (
        <div className="px-4 pb-4">
          <div className="bg-primary/5 relative w-full overflow-hidden rounded-lg p-4 shadow-xs transition-all duration-300">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
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
        </div>
      );
    }

    return (
      <div className="px-4 pb-4">
        <button
          aria-label="Show all media"
          className="bg-primary/5 hover:bg-primary/10 relative w-full cursor-pointer overflow-hidden rounded-lg shadow-xs transition-all duration-300 hover:shadow-md"
          onClick={handleShowAll}
          type="button"
        >
          <div className="flex h-32 items-center justify-between p-4">
            <div className="flex items-center gap-4">
              {remainingAttachments.slice(0, 2).map((m, index) => (
                <div
                  className="relative h-24 w-24 overflow-hidden rounded-lg"
                  key={m.id}
                >
                  {renderPreview(m, index + initialCount)}
                  <div className="absolute inset-0 bg-black/10" />
                </div>
              ))}
            </div>

            <div className="flex flex-col items-end gap-2 pr-4">
              <p className="text-lg font-medium">Show {remainingCount} more</p>
              <Button variant="secondary">Expand</Button>
            </div>
          </div>
        </button>
      </div>
    );
  };

  return (
    <div className="w-full">
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
      </div>

      {interactive && !showAll && attachments.length > initialCount && (
        <ShowMoreSection />
      )}

      {interactive && showAll ? (
        <div className="flex justify-center pb-4">
          <Button
            onClick={handleShowLess}
            size={isMobile ? "sm" : "default"}
            variant="ghost"
          >
            Show Less
          </Button>
        </div>
      ) : null}

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
    </div>
  );
};
