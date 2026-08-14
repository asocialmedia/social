"use client";

import { clientLog } from "@asm/config/debug";
import type { Media, PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Dialog, DialogContent, DialogTitle } from "@asm/ui/shadui/dialog";
import fallbackImage from "@assets/general/nomedia.png";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { ChevronLeft, ChevronRight, Download, FileIcon, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import Comments from "@/components/comments/comments";
import FollowButton from "@/components/layouts/follow-button";
import { MediaViewerSkeleton } from "@/components/layouts/skeletons/media-viewer-skeleton";
import UserAvatar from "@/components/layouts/user-avatar";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import BookmarkButton from "@/components/posts/bookmark-button";
import PostMoreButton from "@/components/posts/post-more-button";
import { PostMeta } from "@/components/tags/post-meta";
import Linkify from "@/helpers/global/linkify";
import { getLanguageFromFileName } from "@/lib/codefile-extensions";
import { formatFileName } from "@/lib/format-file-name";
import { useToast } from "@/lib/gooey-toast";
import { cn, formatNumber } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

import { CodePreview } from "./code-preview";
import { CustomVideoPlayer } from "./custom-video-player";
// eslint-disable-next-line import/no-cycle -- related posts reuse post-card which renders media-previews, which opens this viewer
import RelatedPosts from "./related-posts";
import ShareButton from "./share-button";
import { SVGViewer } from "./svg-viewer";

const FALLBACK_IMAGE = fallbackImage;

const getMediaUrl = (mediaId: string, download = false) =>
  `/api/media/${mediaId}${download ? "?download=true" : ""}`;

interface MediaViewerProps {
  initialIndex?: number;
  isOpen: boolean;
  media: Media[];
  onClose: () => void;
  onNavigate?: (index: number) => void;
  post?: PostData;
}

const MediaViewer = ({
  media,
  initialIndex = 0,
  isOpen,
  onClose,
  onNavigate,
  post,
}: MediaViewerProps) => {
  const { toast } = useToast();
  const { user: sessionUser } = useSession();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const currentMedia = media[currentIndex];

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-compiler -- sync the viewer position when the dialog opens
      setCurrentIndex(initialIndex);
      setIsLoading(true);
    }
  }, [isOpen, initialIndex]);

  const handlePrevious = useCallback(() => {
    setCurrentIndex((prev) => {
      const next = prev > 0 ? prev - 1 : media.length - 1;
      onNavigate?.(next);
      setIsLoading(true);
      return next;
    });
  }, [media.length, onNavigate]);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => {
      const next = prev < media.length - 1 ? prev + 1 : 0;
      onNavigate?.(next);
      setIsLoading(true);
      return next;
    });
  }, [media.length, onNavigate]);

  const handleMediaLoaded = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handleImageError = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      clientLog.error("Image load error:", event);
      event.currentTarget.src = FALLBACK_IMAGE.src;
      setIsLoading(false);
    },
    []
  );

  const handleOpenPdf = useCallback(() => {
    if (currentMedia) {
      window.open(`/api/media/${currentMedia.id}`, "_blank");
    }
  }, [currentMedia]);

  const handleDownload = async () => {
    try {
      setIsDownloading(true);

      if (!currentMedia) {
        toast({
          description: "No file to download yet",
          title: "Download Failed",
          variant: "destructive",
        });
        return;
      }
      const response = await fetch(`/api/media/download/${currentMedia.id}`);

      if (response.status === 429) {
        toast({
          description: "Slow down a bit, then try again",
          title: "Too Many Downloads",
          variant: "destructive",
        });
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to download file");
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = formatFileName(currentMedia.key);
      document.body.append(a);
      a.click();

      window.URL.revokeObjectURL(downloadUrl);
      a.remove();
    } catch (error) {
      clientLog.error("Download failed:", error);
      toast({
        description: "Couldn't download that file, try again?",
        title: "Download Failed",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  // eslint-disable-next-line react/no-unstable-nested-components -- DownloadButton uses parent component state and functions, making it reasonable to keep nested
  const DownloadButton = () => (
    <Button
      className="flex items-center gap-2"
      disabled={isDownloading}
      onClick={handleDownload}
      variant="secondary"
    >
      {isDownloading ? (
        <>
          <span className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
          Fetching file...
        </>
      ) : (
        <>
          <Download className="h-4 w-4" />
          Download {currentMedia ? formatFileName(currentMedia.key) : ""}
        </>
      )}
    </Button>
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) {
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrevious();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      }
    };
    // Escape is handled solely by Radix Dialog (onOpenChange -> onClose) so
    // closing never fires the navigation twice.

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handlePrevious, handleNext]);

  const renderImageMedia = (item: Media) => {
    if (item.mimeType === "image/svg+xml") {
      return (
        <div className="relative flex h-full w-full items-center justify-center">
          {isLoading ? <MediaViewerSkeleton type="IMAGE" /> : null}
          <SVGViewer
            className={cn(
              "flex h-full w-full items-center justify-center",
              isLoading && "hidden"
            )}
            onDownload={handleDownload}
            onLoad={handleMediaLoaded}
            url={getMediaUrl(item.id)}
          />
        </div>
      );
    }

    return (
      <div className="relative flex h-full max-h-full w-full items-center justify-center">
        {isLoading ? <MediaViewerSkeleton type="IMAGE" /> : null}
        <Image
          alt={`Media item ${currentIndex + 1}`}
          className={cn(
            "max-h-full w-auto object-contain",
            isLoading && "hidden"
          )}
          height={800}
          onError={handleImageError}
          onLoad={handleMediaLoaded}
          priority
          quality={100}
          sizes="95vw"
          src={getMediaUrl(item.id)}
          width={1200}
        />
      </div>
    );
  };

  const renderVideoMedia = (item: Media) => (
    <div className="relative flex h-full max-h-full w-full items-center justify-center focus-within:outline-none">
      {isLoading ? <MediaViewerSkeleton type="VIDEO" /> : null}
      <CustomVideoPlayer
        autoPlay
        className={cn(
          "h-full max-h-full w-auto outline-hidden focus:outline-hidden focus-visible:outline-none",
          "shadow-lg",
          isLoading && "hidden"
        )}
        onError={handleMediaLoaded}
        onLoadedData={handleMediaLoaded}
        poster={getMediaProxyUrl(item)}
        src={getMediaUrl(item.id)}
      />
    </div>
  );

  const renderAudioMedia = (item: Media) => (
    <div className="bg-background/50 flex flex-col items-center gap-4 rounded-lg p-8">
      <div className="bg-primary/10 flex h-40 w-40 items-center justify-center rounded-full">
        <FileIcon className="text-primary h-20 w-20" />
      </div>
      <p className="text-lg font-medium">{formatFileName(item.key)}</p>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- audio content may not have captions available */}
      <audio
        aria-label={`Audio ${currentIndex + 1} of ${media.length}`}
        autoPlay
        className="w-full max-w-md"
        controls
        src={getMediaUrl(item.id)}
      />
      <DownloadButton />
    </div>
  );

  const renderCodeMedia = (item: Media) => (
    <div className="bg-background/50 w-full max-w-4xl rounded-lg p-4">
      {isLoading ? (
        <MediaViewerSkeleton type="CODE" />
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="font-medium">{formatFileName(item.key)}</p>
              <p className="text-muted-foreground text-sm">
                {getLanguageFromFileName(item.key)}
              </p>
            </div>
            <Button
              disabled={isDownloading}
              onClick={handleDownload}
              variant="secondary"
            >
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          </div>
          <CodePreview
            className="shadow-lg"
            fileName={formatFileName(item.key)}
            language={getLanguageFromFileName(item.key)}
            mediaId={item.id}
          />
        </>
      )}
    </div>
  );

  const renderDocumentMedia = (item: Media) => (
    <div className="bg-background/50 flex flex-col items-center gap-4 rounded-lg p-8">
      <div className="bg-primary/10 flex h-32 w-32 items-center justify-center rounded-full">
        <FileIcon className="text-primary h-16 w-16" />
      </div>
      <p className="font-medium">{formatFileName(item.key)}</p>
      <p className="text-muted-foreground text-sm">{item.mimeType}</p>
      <div className="flex gap-4">
        <Button
          disabled={isDownloading}
          onClick={handleDownload}
          variant="secondary"
        >
          <Download className="mr-2 h-4 w-4" />
          Download
        </Button>
        {item.mimeType === "application/pdf" && (
          <Button onClick={handleOpenPdf} variant="outline">
            View PDF
          </Button>
        )}
      </div>
    </div>
  );

  const renderMedia = () => {
    if (!currentMedia) {
      return <p className="text-destructive">No media available</p>;
    }

    switch (currentMedia.type) {
      case "IMAGE": {
        return renderImageMedia(currentMedia);
      }
      case "VIDEO": {
        return renderVideoMedia(currentMedia);
      }
      case "AUDIO": {
        return renderAudioMedia(currentMedia);
      }
      case "CODE": {
        return renderCodeMedia(currentMedia);
      }
      case "DOCUMENT": {
        return renderDocumentMedia(currentMedia);
      }
      default: {
        return <p className="text-destructive">Unsupported media type</p>;
      }
    }
  };

  const renderActionBar = () => {
    if (!post) {
      return null;
    }
    return (
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <AuraVoteButton
            authorName={post.user.displayName}
            initialState={{
              aura: post.aura,
              userVote: post.vote[0]?.value || 0,
            }}
            postId={post.id}
          />
          <BookmarkButton
            className="h-9 w-9"
            initialState={{
              isBookmarkedByUser: post.bookmarks.some(
                (bookmark) => bookmark.userId === sessionUser?.id
              ),
            }}
            postId={post.id}
          />
          <ShareButton
            description={post.content}
            postId={post.id}
            thumbnail={
              post.attachments[0]
                ? getMediaProxyUrl(post.attachments[0])
                : undefined
            }
            title={post.content}
          />
        </div>
        <span className="text-muted-foreground pr-2 text-sm lg:hidden">
          {formatNumber(post.viewCount)} views
        </span>
      </div>
    );
  };

  const isSelf = post ? sessionUser?.id === post.user.id : false;

  const renderMobileHeader = () => {
    if (!post) {
      return null;
    }
    return (
      <div className="flex shrink-0 flex-col bg-linear-to-b from-black/80 to-transparent px-3 pt-3 pb-5 lg:hidden">
        <div className="flex items-center justify-between">
          <button
            aria-label="Close viewer"
            className="rounded-full bg-black/40 p-2.5 text-white backdrop-blur-md transition-all hover:bg-black/60 hover:brightness-110"
            onClick={onClose}
            type="button"
          >
            <X className="h-6 w-6" />
          </button>
          {isSelf ? <PostMoreButton className="shrink-0" post={post} /> : null}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Link className="shrink-0" href={`/users/${post.user.username}`}>
            <UserAvatar avatarUrl={post.user.avatarUrl} className="h-10 w-10" />
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              className="block truncate font-semibold text-white hover:underline"
              href={`/users/${post.user.username}`}
            >
              {post.user.displayName}
            </Link>
            <Link
              className="block truncate text-white/70 hover:underline"
              href={`/users/${post.user.username}`}
            >
              @{post.user.username}
            </Link>
          </div>
          {isSelf ? null : (
            <FollowButton
              initialState={{
                followers: post.user._count?.followers ?? 0,
                isFollowedByUser: post.user.followers.length > 0,
              }}
              userId={post.user.id}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog onOpenChange={onClose} open={isOpen}>
      <DialogContent className="h-dvh max-h-dvh max-w-none border-none bg-black p-0 [&>button:last-child]:hidden">
        <DialogTitle asChild>
          <VisuallyHidden>
            Media Viewer - {currentIndex + 1} of {media.length}
          </VisuallyHidden>
        </DialogTitle>

        <div className="flex h-full w-full overflow-hidden">
          <div className="relative flex h-full min-w-0 flex-1 flex-col bg-black">
            {renderMobileHeader()}

            <div className="relative flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden">
              {renderMedia()}

              <button
                aria-label="Close viewer"
                className="absolute top-4 left-3 z-50 hidden rounded-full bg-black/40 p-2.5 text-white backdrop-blur-md transition-all hover:bg-black/60 hover:brightness-110 lg:flex"
                onClick={onClose}
                type="button"
              >
                <X className="h-6 w-6" />
              </button>

              {media.length > 1 && (
                <>
                  <button
                    aria-label="Previous media"
                    className="absolute top-1/2 left-3 z-50 -translate-y-1/2 rounded-full bg-black/40 p-2.5 text-white backdrop-blur-md transition-all hover:bg-black/60 hover:brightness-110"
                    onClick={handlePrevious}
                    type="button"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    aria-label="Next media"
                    className="absolute top-1/2 right-3 z-50 -translate-y-1/2 rounded-full bg-black/40 p-2.5 text-white backdrop-blur-md transition-all hover:bg-black/60 hover:brightness-110"
                    onClick={handleNext}
                    type="button"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>

                  <div className="absolute top-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 backdrop-blur-md">
                    <span className="text-sm text-white">
                      {currentIndex + 1} / {media.length}
                    </span>
                  </div>
                </>
              )}
            </div>

            {post ? renderActionBar() : null}
          </div>

          {post ? (
            <aside className="hidden h-full w-95 flex-col border-l border-white/10 bg-[hsl(var(--background))] lg:flex">
              <div className="flex items-center gap-3 px-4 py-3">
                <Link
                  className="shrink-0"
                  href={`/users/${post.user.username}`}
                >
                  <UserAvatar
                    avatarUrl={post.user.avatarUrl}
                    className="h-10 w-10"
                  />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    className="text-foreground block truncate font-semibold hover:underline"
                    href={`/users/${post.user.username}`}
                  >
                    {post.user.displayName}
                  </Link>
                  <Link
                    className="text-muted-foreground block truncate hover:underline"
                    href={`/users/${post.user.username}`}
                  >
                    @{post.user.username}
                  </Link>
                </div>
                {sessionUser?.id === post.user.id ? (
                  <PostMoreButton className="shrink-0" post={post} />
                ) : null}
              </div>

              <div className="px-4 pt-1 pb-2">
                <Linkify>
                  <p className="text-foreground text-[15px] leading-relaxed wrap-break-word whitespace-pre-wrap">
                    {post.content}
                  </p>
                </Linkify>
                {post.tags?.length || post.mentions?.length ? (
                  <div className="mt-3">
                    <PostMeta
                      mentions={post.mentions.map((m) => m.user)}
                      tags={post.tags}
                    />
                  </div>
                ) : null}
              </div>

              <div className="text-muted-foreground flex items-center gap-2 px-4 pb-2 text-sm">
                <span>
                  {new Date(post.createdAt).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span aria-hidden>·</span>
                <span>
                  {new Date(post.createdAt).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <div className="flex-1" />
                <span>{formatNumber(post.viewCount)} views</span>
              </div>

              <div className="border-border/60 flex items-center gap-1 border-y px-4 py-2">
                <AuraVoteButton
                  authorName={post.user.displayName}
                  initialState={{
                    aura: post.aura,
                    userVote: post.vote[0]?.value || 0,
                  }}
                  postId={post.id}
                />
                <div className="flex-1" />
                <BookmarkButton
                  className="h-9 w-9"
                  initialState={{
                    isBookmarkedByUser: post.bookmarks.some(
                      (bookmark) => bookmark.userId === sessionUser?.id
                    ),
                  }}
                  postId={post.id}
                />
                <ShareButton
                  description={post.content}
                  postId={post.id}
                  thumbnail={
                    post.attachments[0]
                      ? getMediaProxyUrl(post.attachments[0])
                      : undefined
                  }
                  title={post.content}
                />
              </div>

              <div className="flex-1 overflow-y-auto">
                <div className="px-4 py-3">
                  <Comments post={post} />
                </div>
                <div>
                  <div className="flex items-center justify-between px-4 py-2">
                    <span className="text-sm font-semibold">
                      View more content
                    </span>
                    <Link
                      aria-label="View all posts on the global feed"
                      className="text-primary shrink-0 text-sm font-medium hover:underline"
                      href="/"
                    >
                      View all posts
                    </Link>
                  </div>
                  <RelatedPosts excludePostId={post.id} />
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MediaViewer;
