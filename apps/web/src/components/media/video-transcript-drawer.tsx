"use client";

import { Button } from "@asm/ui/shadui/button";
import zephImage from "@assets/zeph.png";
import { Check, Copy, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

export interface TranscriptCue {
  end: number;
  start: number;
  text: string;
}

interface VideoTranscriptDrawerProps {
  currentTime?: number;
  isOpen: boolean;
  mediaId: string;
  onClose: () => void;
  onSeek: (seconds: number) => void;
  rawTranscript?: string | null;
}

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function parseWebVttCues(vttText: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const lines = vttText.split(/\r?\n/);
  let currentStart = 0;
  let currentEnd = 0;
  let hasActiveCue = false;
  let textBuffer: string[] = [];

  const timeRegex =
    /(?:(?<sH>\d{2}):)?(?<sM>\d{2}):(?<sS>\d{2})\.(?<sMs>\d{3})\s*-->\s*(?:(?<eH>\d{2}):)?(?<eM>\d{2}):(?<eS>\d{2})\.(?<eMs>\d{3})/;

  for (const rawLine of lines) {
    const line = rawLine ? rawLine.trim() : "";
    if (!line) {
      if (hasActiveCue && textBuffer.length > 0) {
        cues.push({
          end: currentEnd,
          start: currentStart,
          text: textBuffer.join(" "),
        });
        textBuffer = [];
        hasActiveCue = false;
      }
      continue;
    }

    const match = line.match(timeRegex);
    if (match) {
      if (hasActiveCue && textBuffer.length > 0) {
        cues.push({
          end: currentEnd,
          start: currentStart,
          text: textBuffer.join(" "),
        });
        textBuffer = [];
      }
      const groups = match.groups || {};
      const startH = Number(groups.sH || 0);
      const startM = Number(groups.sM || 0);
      const startS = Number(groups.sS || 0);
      const startMs = Number(groups.sMs || 0);
      currentStart = startH * 3600 + startM * 60 + startS + startMs / 1000;

      const endH = Number(groups.eH || 0);
      const endM = Number(groups.eM || 0);
      const endS = Number(groups.eS || 0);
      const endMs = Number(groups.eMs || 0);
      currentEnd = endH * 3600 + endM * 60 + endS + endMs / 1000;
      hasActiveCue = true;
    } else if (
      hasActiveCue &&
      !line.startsWith("WEBVTT") &&
      !/^\d+$/.test(line)
    ) {
      textBuffer.push(line);
    }
  }

  if (hasActiveCue && textBuffer.length > 0) {
    cues.push({
      end: currentEnd,
      start: currentStart,
      text: textBuffer.join(" "),
    });
  }

  return cues;
}

export const VideoTranscriptDrawer: React.FC<VideoTranscriptDrawerProps> = ({
  mediaId,
  isOpen,
  onClose,
  onSeek,
  currentTime = 0,
  rawTranscript,
}) => {
  const [cues, setCues] = useState<TranscriptCue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const activeCueRef = useRef<HTMLButtonElement | null>(null);
  const { toast } = useToast();

  // Load captions WebVTT file and parse cues
  useEffect(() => {
    if (!isOpen || !mediaId) {
      return;
    }
    let isCancelled = false;

    async function loadTranscript() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/media/${mediaId}?captions=1`);
        if (res.ok) {
          const vttText = await res.text();
          if (!isCancelled) {
            const parsed = parseWebVttCues(vttText);
            setCues(parsed);
          }
        }
      } catch {
        if (!isCancelled && rawTranscript) {
          setCues([{ end: 999, start: 0, text: rawTranscript }]);
        }
      }
      if (!isCancelled) {
        setIsLoading(false);
      }
    }

    void loadTranscript();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, mediaId, rawTranscript]);

  // Determine active cue index
  const activeIndex = useMemo(
    () =>
      cues.findIndex(
        (c) =>
          currentTime >= c.start &&
          currentTime <= Math.max(c.end, c.start + 1.5)
      ),
    [cues, currentTime]
  );

  // Filtered cues based on user search
  const filteredCues = useMemo(() => {
    if (!searchQuery.trim()) {
      return cues;
    }
    const q = searchQuery.toLowerCase();
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

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="pointer-events-auto absolute inset-x-0 bottom-0 z-60 flex max-h-[80%] min-h-[320px] flex-col rounded-t-2xl border-t border-white/15 bg-black/95 text-white shadow-2xl backdrop-blur-xl"
          exit={{ opacity: 0, y: "100%" }}
          initial={{ opacity: 0, y: "100%" }}
          onClick={(e) => e.stopPropagation()}
          transition={{ damping: 25, stiffness: 260, type: "spring" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Image
                alt="Zeph"
                className="size-8.5 shrink-0 object-contain drop-shadow-sm"
                src={zephImage}
              />
              <div>
                <h3 className="text-sm leading-tight font-semibold text-white">
                  Transcript
                </h3>
                <p className="text-[11px] leading-tight text-white/60">
                  Tap any sentence to seek video
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                aria-label="Copy transcript"
                className="h-8 gap-1.5 rounded-full bg-white/10 px-3 text-xs text-white hover:bg-white/20"
                onClick={handleCopy}
                size="sm"
                variant="ghost"
              >
                {copied ? (
                  <>
                    <Check className="size-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </Button>
              <button
                aria-label="Close transcript"
                className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
                onClick={onClose}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Search bar within transcript */}
          <div className="border-b border-white/10 px-4 py-2">
            <div className="relative flex items-center">
              <Search className="absolute left-3 size-3.5 text-white/40" />
              <input
                aria-label="Search transcript"
                className="w-full rounded-lg bg-white/10 py-1.5 pr-3 pl-8 text-xs text-white placeholder-white/40 outline-hidden transition-all focus:bg-white/15 focus:ring-1 focus:ring-orange-500/50"
                onChange={(e) => setSearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Search in transcript..."
                type="text"
                value={searchQuery}
              />
            </div>
          </div>

          {/* Cues List */}
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {(() => {
              if (isLoading) {
                return (
                  <div className="flex h-32 items-center justify-center">
                    <div className="size-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                  </div>
                );
              }

              if (filteredCues.length > 0) {
                return filteredCues.map((cue, idx) => {
                  const isCurrent = cues[activeIndex]?.start === cue.start;
                  return (
                    <button
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl p-2.5 text-left transition-all",
                        isCurrent
                          ? "border border-orange-500/60 bg-linear-to-r from-orange-500/25 via-orange-500/15 to-transparent shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2),inset_0_1px_2px_rgba(255,255,255,0.25),0_0_0_1px_rgba(255,149,0,0.6),0_2px_6px_rgba(0,0,0,0.3)]"
                          : "border border-transparent hover:bg-white/10 active:bg-white/15"
                      )}
                      key={`${cue.start}-${cue.end}-${idx}`}
                      onClick={() => onSeek(cue.start)}
                      ref={isCurrent ? activeCueRef : undefined}
                      type="button"
                    >
                      <span
                        className={cn(
                          "mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold transition-colors",
                          isCurrent
                            ? "bg-linear-to-b from-[#ff9500] to-[#e65500] font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(0,0,0,0.12)]"
                            : "bg-white/10 text-white/60 group-hover:text-white"
                        )}
                      >
                        {formatSeconds(cue.start)}
                      </span>
                      <p
                        className={cn(
                          "text-xs leading-relaxed transition-colors",
                          isCurrent ? "font-medium text-white" : "text-white/80"
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
                  <p className="text-xs leading-relaxed whitespace-pre-wrap text-white/90">
                    {rawTranscript}
                  </p>
                );
              }

              return (
                <div className="flex h-32 flex-col items-center justify-center gap-2 text-center text-white/50">
                  <Image
                    alt="Zeph"
                    className="size-8 object-contain opacity-50 grayscale"
                    src={zephImage}
                  />
                  <p className="text-xs">
                    No transcript available for this video
                  </p>
                </div>
              );
            })()}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
