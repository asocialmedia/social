"use client";

import type { PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Textarea } from "@asm/ui/shadui/textarea";
import { Clapperboard, Loader2, Upload, Video, X } from "lucide-react";
import React, { useCallback, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";

import { useSession } from "@/app/(main)/session-provider";
import LoadingButton from "@/components/auth/loading-button";
import { useToast } from "@/lib/gooey-toast";
import { submitPost } from "@/posts/editor/actions";

interface UploadGustDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newGust: PostData) => void;
}

export const UploadGustDialog: React.FC<UploadGustDialogProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { user } = useSession();
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const resetState = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setCaption("");
    setIsUploading(false);
    setUploadProgress(0);
  }, [previewUrl]);

  const handleClose = useCallback(() => {
    if (!isUploading) {
      resetState();
      onClose();
    }
  }, [isUploading, onClose, resetState]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const [file] = acceptedFiles;
      if (!file) {
        return;
      }
      if (!file.type.startsWith("video/")) {
        toast({
          description: "Please select a valid video file (MP4, WebM, MOV).",
          title: "Invalid File",
          variant: "destructive",
        });
        return;
      }
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    },
    [previewUrl, toast]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "video/*": [".mp4", ".mov", ".webm", ".mkv"] },
    maxFiles: 1,
    maxSize: 128 * 1024 * 1024,
    onDrop,
  });

  const handleUpload = async () => {
    if (!selectedFile || !user) {
      return;
    }

    try {
      setIsUploading(true);
      setUploadProgress(10);

      // 1. Upload video to storage endpoint
      const formData = new FormData();
      formData.append("file", selectedFile);

      setUploadProgress(30);
      const uploadRes = await fetch("/api/upload", {
        body: formData,
        method: "POST",
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload video");
      }

      setUploadProgress(75);
      const { mediaId } = (await uploadRes.json()) as { mediaId: string };

      // 2. Extract tags from caption (#tag)
      const extractedTags = (caption.match(/#[a-z0-9_]+/gi) || []).map((t) =>
        t.slice(1).toLowerCase()
      );

      // 3. Submit post with isGust: true
      const post = (await submitPost({
        content: caption.trim() || "Gust video",
        isGust: true,
        mediaIds: [mediaId],
        mentions: [],
        tags: extractedTags,
      })) as PostData;

      setUploadProgress(100);
      toast({
        description: "Your Gust has been shared successfully!",
        title: "Gust Published",
      });

      onSuccess?.(post);
      handleClose();
    } catch (error) {
      console.error("Gust upload failed:", error);
      toast({
        description:
          error instanceof Error ? error.message : "Upload failed, try again.",
        title: "Upload Failed",
        variant: "destructive",
      });
      setIsUploading(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && handleClose()} open={isOpen}>
      <DialogContent className="border-border max-w-md overflow-hidden rounded-3xl bg-[hsl(var(--background-alt))] p-6 sm:max-w-lg">
        <DialogHeader className="mb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-xs">
              <Clapperboard className="size-4.5" />
            </div>
            <div>
              <DialogTitle className="text-foreground text-lg font-bold">
                Create a Gust
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-xs">
                Share high-energy short-form clips with the community
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {previewUrl ? (
            <div className="relative flex flex-col items-center">
              <div className="relative aspect-[9/16] max-h-[340px] w-full max-w-[200px] overflow-hidden rounded-2xl bg-black shadow-md">
                <video
                  autoPlay
                  className="h-full w-full object-cover"
                  loop
                  muted
                  playsInline
                  ref={videoRef}
                  src={previewUrl}
                />
                <button
                  aria-label="Remove selected video"
                  className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition-transform hover:scale-110"
                  disabled={isUploading}
                  onClick={resetState}
                  type="button"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="text-muted-foreground mt-2 truncate text-xs">
                {selectedFile?.name} (
                {((selectedFile?.size ?? 0) / (1024 * 1024)).toFixed(1)} MB)
              </p>
            </div>
          ) : (
            <div
              {...getRootProps()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
                isDragActive
                  ? "border-primary bg-primary/10"
                  : "border-border/80 hover:border-primary/60 hover:bg-muted/20"
              }`}
            >
              <input {...getInputProps()} />
              <div className="bg-primary/10 text-primary mb-3 flex h-14 w-14 items-center justify-center rounded-full">
                <Video className="size-7" />
              </div>
              <p className="text-foreground text-sm font-semibold">
                Drop your video here, or{" "}
                <span className="text-primary underline">browse</span>
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                MP4, WebM or MOV (up to 128MB, 9:16 portrait recommended)
              </p>
            </div>
          )}

          <div>
            <label
              className="text-foreground mb-1.5 block text-xs font-semibold"
              htmlFor="gust-caption"
            >
              Caption & Tags
            </label>
            <Textarea
              className="border-border bg-background/50 focus:border-primary min-h-[80px] resize-none rounded-xl text-sm"
              disabled={isUploading}
              id="gust-caption"
              maxLength={280}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="What's happening in this clip? #gusts #chill"
              value={caption}
            />
            <div className="text-muted-foreground mt-1 flex justify-end text-[11px]">
              {caption.length}/280
            </div>
          </div>

          {isUploading ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-primary flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" />
                  Uploading & extracting thumbnail...
                </span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                <div
                  className="h-full bg-linear-to-r from-[#ff9500] to-[#e65500] transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              disabled={isUploading}
              onClick={handleClose}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <LoadingButton
              disabled={!selectedFile || isUploading}
              loading={isUploading}
              onClick={handleUpload}
              variant="premium"
            >
              <Upload className="mr-1.5 size-4" />
              Publish Gust
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
