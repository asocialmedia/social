// Timed caption cues for feed videos, ported from web's
// video-transcript-drawer (parseWebVttCues / splitTranscriptIntoTimedLines /
// splitCueIntoLines) plus VideoPreview's direct-transcript fallback. Pure so
// the parsing is unit-testable without react-native.

export interface TranscriptCue {
  end: number;
  start: number;
  text: string;
}

const SENTENCE_SPLIT = /(?<=[.?!])\s+|\r?\n+/;
const WORD_SPLIT = /\s+/;
const VTT_TIMESTAMP =
  /(?:\d{2}:)?\d{2}:\d{2}\.\d{3}\s*-->\s*(?:\d{2}:)?\d{2}:\d{2}\.\d{3}/;
const VTT_CUE_TIMING =
  /(?:(?<sH>\d{2}):)?(?<sM>\d{2}):(?<sS>\d{2})\.(?<sMs>\d{3})\s*-->\s*(?:(?<eH>\d{2}):)?(?<eM>\d{2}):(?<eS>\d{2})\.(?<eMs>\d{3})/;
const CUE_INDEX_LINE = /^\d+$/;

function wordsInText(text: string): number {
  return text.trim().split(WORD_SPLIT).filter(Boolean).length;
}

// Sentence-first, then fixed-size word chunks for long sentences.
function chunkIntoLines(text: string, maxWordsPerLine: number): string[] {
  const lines: string[] = [];
  const sentences = text
    .split(SENTENCE_SPLIT)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  for (const sentence of sentences) {
    const words = sentence.split(WORD_SPLIT).filter(Boolean);
    if (words.length <= maxWordsPerLine) {
      lines.push(words.join(" "));
      continue;
    }
    for (let index = 0; index < words.length; index += maxWordsPerLine) {
      lines.push(words.slice(index, index + maxWordsPerLine).join(" "));
    }
  }
  return lines;
}

// Splits one long VTT cue into readable lines, sharing the cue's time span
// in proportion to each line's word count.
export function splitCueIntoLines(
  cue: TranscriptCue,
  maxWordsPerLine = 8
): TranscriptCue[] {
  const text = cue.text.trim();
  if (!text) {
    return [];
  }
  const lines = chunkIntoLines(text, maxWordsPerLine);
  if (lines.length <= 1) {
    return [cue];
  }
  const duration = Math.max(0.5, cue.end - cue.start);
  const totalWords = wordsInText(text);
  let currentStart = cue.start;
  return lines.map((lineText) => {
    const lineDuration =
      (wordsInText(lineText) / Math.max(1, totalWords)) * duration;
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

// Untimed transcript: lines are spread across the clip (or ~0.38s per word
// when the duration is unknown), proportional to their word counts.
export function splitTranscriptIntoTimedLines(
  rawTranscript: string,
  totalDurationSec?: number | null,
  maxWordsPerLine = 7
): TranscriptCue[] {
  const text = rawTranscript.trim();
  if (!text) {
    return [];
  }
  const lines = chunkIntoLines(text, maxWordsPerLine);
  if (lines.length === 0) {
    const words = text.split(WORD_SPLIT).filter(Boolean);
    for (let index = 0; index < words.length; index += maxWordsPerLine) {
      lines.push(words.slice(index, index + maxWordsPerLine).join(" "));
    }
  }
  const totalWords = lines.reduce((sum, line) => sum + wordsInText(line), 0);
  const defaultDuration = Math.max(3, totalWords * 0.38);
  const duration =
    totalDurationSec && totalDurationSec > 0
      ? totalDurationSec
      : defaultDuration;
  let currentStart = 0;
  return lines.map((lineText, index) => {
    const isLast = index === lines.length - 1;
    const lineDuration =
      (wordsInText(lineText) / Math.max(1, totalWords)) * duration;
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

function timingSeconds(
  hours: string | undefined,
  minutes: string | undefined,
  seconds: string | undefined,
  millis: string | undefined
): number {
  return (
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0) +
    Number(millis ?? 0) / 1000
  );
}

export function parseWebVttCues(vttText: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  let currentStart = 0;
  let currentEnd = 0;
  let hasActiveCue = false;
  let textBuffer: string[] = [];

  const flushCue = () => {
    if (hasActiveCue && textBuffer.length > 0) {
      cues.push(
        ...splitCueIntoLines({
          end: currentEnd,
          start: currentStart,
          text: textBuffer.join(" "),
        })
      );
      textBuffer = [];
      hasActiveCue = false;
    }
  };

  for (const rawLine of vttText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushCue();
      continue;
    }
    const groups = VTT_CUE_TIMING.exec(line)?.groups;
    if (groups) {
      flushCue();
      currentStart = timingSeconds(groups.sH, groups.sM, groups.sS, groups.sMs);
      currentEnd = timingSeconds(groups.eH, groups.eM, groups.eS, groups.eMs);
      hasActiveCue = true;
    } else if (
      hasActiveCue &&
      !line.startsWith("WEBVTT") &&
      !CUE_INDEX_LINE.test(line)
    ) {
      textBuffer.push(line);
    }
  }
  flushCue();
  return cues;
}

// VideoPreview's inline fallback: a stored transcript may already be WebVTT
// (parse its timings) or plain text (spread it across the clip).
export function cuesFromTranscript(
  transcript: string | null | undefined,
  durationSec?: number | null
): TranscriptCue[] {
  if (!transcript) {
    return [];
  }
  if (VTT_TIMESTAMP.test(transcript)) {
    return parseWebVttCues(transcript);
  }
  return splitTranscriptIntoTimedLines(transcript, durationSec);
}

export function findActiveCue(
  cues: readonly TranscriptCue[],
  currentTime: number
): TranscriptCue | null {
  return (
    cues.find((cue) => currentTime >= cue.start && currentTime <= cue.end) ??
    null
  );
}
