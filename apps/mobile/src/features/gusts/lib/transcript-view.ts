// Transcript drawer rules, ported from web's video-transcript-drawer: a cue
// is live from its start until max(end, start + 1.5s) so short cues still
// highlight, search matches case-insensitively, timestamps read m:ss, and
// Copy takes the cue text (or the raw transcript when there are no cues).
import type { TranscriptCue } from "@/features/feed/lib/transcript-cues";

export function isCueActive(cue: TranscriptCue, time: number): boolean {
  return time >= cue.start && time <= Math.max(cue.end, cue.start + 1.5);
}

export function filterCues(
  cues: readonly TranscriptCue[],
  query: string
): TranscriptCue[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...cues];
  }
  return cues.filter((cue) => cue.text.toLowerCase().includes(needle));
}

export function formatCueTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function transcriptCopyText(
  cues: readonly TranscriptCue[],
  raw: string | null | undefined
): string {
  if (cues.length > 0) {
    return cues.map((cue) => cue.text).join(" ");
  }
  return raw?.trim() ?? "";
}
