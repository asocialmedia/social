import type { Media } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { FileAudioIcon, FileCode, FileIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { MdPlayArrow } from "react-icons/md";
import { useMediaQuery } from "usehooks-ts";
import { getLanguageFromFileName } from "@/lib/codefile-extensions";
import { formatFileName } from "@/lib/format-file-name";
import { cn } from "@/lib/utils";
import MediaViewer from "./media-viewer";

interface MediaPreviewsProps {
  attachments: Media[];
  interactive?: boolean;
}

export function MediaPreviews({
  attachments,
  interactive = true,
}: MediaPreviewsProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");

  const getMediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

  const handleShowAll = useCallback(() => {
    setShowAll(true);
  }, []);

  const handleShowLess = useCallback(() => {
    setShowAll(false);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setSelectedIndex(null);
  }, []);

  const videoOverlayVariants = {
    initial: { opacity: 0, scale: 0.8 },
    animate: { opacity: 1, scale: 1 },
    hover: { scale: 1.05 },
    exit: { opacity: 0, scale: 0.8 },
  };

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

  const renderVideoPreview = (m: Media, isSmall: boolean) => (
    <div
      className={cn(
        "group relative w-full overflow-hidden",
        isSmall ? "h-20" : "h-56"
      )}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: suppress */}
      <video
        className={getCommonClasses(isSmall)}
        preload="metadata"
        src={getMediaUrl(m.id)}
      />
      <motion.div
        animate="animate"
        className="absolute inset-0 flex items-center justify-center"
        exit="exit"
        initial="initial"
        variants={videoOverlayVariants}
        whileHover="hover"
      >
        <div className="relative">
          <div className="absolute -inset-4">
            <div className="absolute inset-0 rounded-full bg-white/10 group-hover:animate-ping" />
            <div className="absolute inset-0 rounded-full bg-black/20 blur-xs group-hover:animate-pulse" />
          </div>
          <motion.div
            className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-xs transition-colors duration-300 group-hover:bg-white/20"
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            whileHover={{ scale: 1.1, rotate: 360 }}
          >
            <MdPlayArrow
              className={cn(
                "transition-all duration-300",
                isSmall ? "h-6 w-6" : "h-8 w-8",
                "text-white group-hover:text-white",
                "group-hover:scale-110"
              )}
            />
          </motion.div>
        </div>
      </motion.div>
      <div className="absolute inset-0 bg-linear-to-t from-black/50 via-transparent to-transparent opacity-40 transition-all duration-300 group-hover:opacity-20" />
    </div>
  );

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
        return renderVideoPreview(m, isSmall);
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
    (index: number) => () => setSelectedIndex(index),
    []
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
              className="!relative !h-auto max-h-[480px] w-auto max-w-full rounded-lg object-cover"
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

    const handleSelect = useCallback(() => {
      setSelectedIndex(index);
    }, [index]);

    return interactive ? (
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        aria-label="View attachment"
        className={cn(
          "relative cursor-pointer overflow-hidden rounded-lg shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md",
          isSmall ? "h-20" : "h-56"
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
          isSmall ? "h-20" : "h-56"
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
        />
      )}
    </motion.div>
  );
}
