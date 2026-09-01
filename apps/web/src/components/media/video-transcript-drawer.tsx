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

function wordsInText(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function splitCueIntoLines(
  cue: TranscriptCue,
  maxWordsPerLine = 8
): TranscriptCue[] {
  const text = cue.text.trim();
  if (!text) {
    return [];
  }

  // Split by sentence boundaries first
  const sentences = text
    .split(/(?<=[.?!])\s+|\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const lines: string[] = [];
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length <= maxWordsPerLine) {
      lines.push(words.join(" "));
    } else {
      for (let i = 0; i < words.length; i += maxWordsPerLine) {
        lines.push(words.slice(i, i + maxWordsPerLine).join(" "));
      }
    }
  }

  if (lines.length <= 1) {
    return [cue];
  }

  const duration = Math.max(0.5, cue.end - cue.start);
  const totalWords = wordsInText(text);
  let currentStart = cue.start;

  return lines.map((lineText) => {
    const lineWords = wordsInText(lineText);
    const lineDuration = (lineWords / Math.max(1, totalWords)) * duration;
    const start = currentStart;
    const end = Math.min(cue.end, start + lineDuration);
    currentStart = end;
    return {
      end: Number(end.toFixed(3)),
      start: Number(start.toFixed(3)),
      text: lineText,
    };
  });
}

export function splitTranscriptIntoTimedLines(
  rawTranscript: string,
  totalDurationSec?: number | null,
  maxWordsPerLine = 7
): TranscriptCue[] {
  const text = rawTranscript.trim();
  if (!text) {
    return [];
  }

  const rawChunks = text
    .split(/(?<=[.?!])\s+|\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const lines: string[] = [];
  for (const chunk of rawChunks) {
    const words = chunk.split(/\s+/).filter(Boolean);
    if (words.length <= maxWordsPerLine) {
      lines.push(words.join(" "));
    } else {
      for (let i = 0; i < words.length; i += maxWordsPerLine) {
        lines.push(words.slice(i, i + maxWordsPerLine).join(" "));
      }
    }
  }

  if (lines.length === 0) {
    const words = text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += maxWordsPerLine) {
      lines.push(words.slice(i, i + maxWordsPerLine).join(" "));
    }
  }

  const totalWords = lines.reduce((acc, l) => acc + wordsInText(l), 0);
  const defaultDuration = Math.max(3, totalWords * 0.38);
  const duration =
    totalDurationSec && totalDurationSec > 0
      ? totalDurationSec
      : defaultDuration;

  let currentStart = 0;
  return lines.map((lineText, idx) => {
    const lineWords = wordsInText(lineText);
    const isLast = idx === lines.length - 1;
    const lineDuration = (lineWords / Math.max(1, totalWords)) * duration;
    const start = currentStart;
    const end = isLast ? duration : Math.min(duration, start + lineDuration);
    currentStart = end;
    return {
      end: Number(end.toFixed(3)),
      start: Number(start.toFixed(3)),
      text: lineText,
    };
  });
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

  const flushCue = () => {
    if (hasActiveCue && textBuffer.length > 0) {
      const subCues = splitCueIntoLines({
        end: currentEnd,
        start: currentStart,
        text: textBuffer.join(" "),
      });
      cues.push(...subCues);
      textBuffer = [];
      hasActiveCue = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine ? rawLine.trim() : "";
    if (!line) {
      flushCue();
      continue;
    }

    const match = line.match(timeRegex);
    if (match) {
      flushCue();
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

  flushCue();

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
    // Stale cues from a previously opened media must not linger while the
    // new transcript loads or if the request fails.
    // oxlint-disable-next-line react/set-state-in-effect
    setCues([]);

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
          className="pointer-events-auto absolute inset-x-0 bottom-0 z-70 flex max-h-[75vh] min-h-80 flex-col rounded-t-3xl border-t border-white/15 bg-black/95 text-white shadow-2xl backdrop-blur-2xl"
          exit={{ opacity: 0, y: "100%" }}
          initial={{ opacity: 0, y: "100%" }}
          onClick={(e) => e.stopPropagation()}
          transition={{ damping: 28, stiffness: 280, type: "spring" }}
        >
          {/* Mobile grab handle pill */}
          <div className="flex justify-center pt-2.5 pb-0.5">
            <div className="h-1 w-10 rounded-full bg-white/30" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
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
                          ? "border border-orange-500 bg-orange-500/15 ring-1 ring-orange-400/40 ring-inset"
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
                            ? "bg-linear-to-b from-[#ff9500] to-[#e65500] font-bold text-white shadow-xs"
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
