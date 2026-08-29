"use client";

import zephImage from "@assets/zeph.png";
import { Check, Copy, Search } from "lucide-react";
import Image from "next/image";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { parseWebVttCues } from "@/components/media/video-transcript-drawer";
import type { TranscriptCue } from "@/components/media/video-transcript-drawer";
import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

interface VideoTranscriptSidebarProps {
  className?: string;
  currentTime?: number;
  mediaId: string;
  onSeek?: (seconds: number) => void;
  rawTranscript?: string | null;
}

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const VideoTranscriptSidebar: React.FC<VideoTranscriptSidebarProps> = ({
  className,
  currentTime,
  mediaId,
  onSeek,
  rawTranscript,
}) => {
  const [cues, setCues] = useState<TranscriptCue[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!mediaId) {
      // oxlint-disable-next-line react/set-state-in-effect
      setCues([]);
      return;
    }
    let cancelled = false;
    async function loadCues() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/media/${mediaId}?captions=1`);
        if (res.ok) {
          const vtt = await res.text();
          if (!cancelled && vtt) {
            setCues(parseWebVttCues(vtt));
          }
        }
      } catch {
        // Fall back to empty cues
      }
      if (!cancelled) {
        setIsLoading(false);
      }
    }
    void loadCues();
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  const filteredCues = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return cues;
    }
    return cues.filter((c) => c.text.toLowerCase().includes(q));
  }, [cues, searchQuery]);

  const handleCopy = useCallback(() => {
    const fullText =
      cues.length > 0 ? cues.map((c) => c.text).join(" ") : rawTranscript || "";
    if (!fullText) {
      return;
    }
    void navigator.clipboard.writeText(fullText);
    setCopied(true);
    toast({ title: "Transcript copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  }, [cues, rawTranscript, toast]);

  const handleSeekCue = useCallback(
    (seconds: number) => {
      if (onSeek) {
        onSeek(seconds);
        return;
      }
      // Default to finding the video element on the desktop page
      const video = document.querySelector("video");
      if (video) {
        video.currentTime = seconds;
        void video.play();
      }
    },
    [onSeek]
  );

  if (!rawTranscript && cues.length === 0 && !isLoading) {
    return null;
  }

  return (
    <div className={cn("sidebar-subcard rounded-2xl p-3", className)}>
      {/* Header */}
      <div className="border-border/50 flex items-center justify-between border-b pb-2.5">
        <div className="flex items-center gap-2">
          <Image
            alt="Zeph"
            className="size-5 shrink-0 object-contain drop-shadow-xs"
            src={zephImage}
          />
          <div>
            <h3 className="text-foreground text-xs font-semibold">
              Transcript
            </h3>
            <p className="text-muted-foreground text-[10px]">
              Click any line to seek video
            </p>
          </div>
        </div>

        <button
          aria-label="Copy transcript"
          className="bg-muted/60 text-foreground hover:bg-muted flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-colors active:translate-y-px"
          onClick={handleCopy}
          type="button"
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-500" />
              <span className="text-emerald-500">Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Search Input */}
      {cues.length > 3 ? (
        <div className="pt-2">
          <div className="relative flex items-center">
            <Search className="text-muted-foreground/60 absolute left-2.5 size-3" />
            <input
              aria-label="Search transcript"
              className="bg-muted/50 text-foreground placeholder-muted-foreground/60 focus:bg-muted/80 w-full rounded-lg py-1 pr-2.5 pl-7 text-[11px] outline-hidden transition-all focus:ring-1 focus:ring-orange-500/50"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search transcript..."
              type="text"
              value={searchQuery}
            />
          </div>
        </div>
      ) : null}

      {/* Cues List */}
      <div className="hide-native-scrollbar mt-2 max-h-52 space-y-1 overflow-y-auto pr-0.5">
        {(() => {
          if (isLoading) {
            return (
              <div className="flex h-20 items-center justify-center">
                <div className="size-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
              </div>
            );
          }

          if (filteredCues.length > 0) {
            return filteredCues.map((cue, idx) => {
              const isCurrent =
                currentTime !== undefined &&
                currentTime >= cue.start &&
                currentTime <= cue.end;

              return (
                <button
                  className={cn(
                    "group flex w-full items-start gap-2 rounded-lg p-1.5 text-left transition-all",
                    isCurrent
                      ? "border border-orange-500/40 bg-orange-500/10 shadow-xs"
                      : "hover:bg-muted/60 active:bg-muted"
                  )}
                  key={`${cue.start}-${cue.end}-${idx}`}
                  onClick={() => handleSeekCue(cue.start)}
                  type="button"
                >
                  <span
                    className={cn(
                      "py-0.2 mt-0.5 shrink-0 rounded px-1 font-mono text-[10px] font-semibold transition-colors",
                      isCurrent
                        ? "bg-orange-500 font-bold text-white"
                        : "bg-muted text-muted-foreground group-hover:text-foreground"
                    )}
                  >
                    {formatSeconds(cue.start)}
                  </span>
                  <p
                    className={cn(
                      "text-[11px] leading-snug transition-colors",
                      isCurrent
                        ? "text-foreground font-medium"
                        : "text-foreground/80"
                    )}
                  >
                    {cue.text}
                  </p>
                </button>
              );
            });
          }

          if (rawTranscript) {
            return (
              <p className="text-foreground/80 p-1 text-xs leading-relaxed">
                {rawTranscript}
              </p>
            );
          }

          return null;
        })()}
      </div>
    </div>
  );
};
