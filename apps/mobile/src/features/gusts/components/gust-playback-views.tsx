// The gust card's position-driven children, each subscribed to the card's
// playback clock on its own, so a timeUpdate re-renders only these and not
// the card around them.
import { useSyncExternalStore } from "react";

import { findActiveCue } from "@/features/feed/lib/transcript-cues";
import type { TranscriptCue } from "@/features/feed/lib/transcript-cues";

import type { PlaybackClock } from "../lib/playback-clock";
import { LiveCaption, SeekBar } from "./gust-overlays";
import { TranscriptDrawer } from "./transcript-drawer";

function usePlaybackSeconds(clock: PlaybackClock): number {
  return useSyncExternalStore(clock.subscribe, clock.get, clock.get);
}

export function ClockedSeekBar({
  clock,
  duration,
  onSeek,
}: {
  clock: PlaybackClock;
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  const seconds = usePlaybackSeconds(clock);
  const progress = duration > 0 ? seconds / duration : 0;
  return <SeekBar duration={duration} onSeek={onSeek} progress={progress} />;
}

export function ClockedLiveCaption({
  clock,
  cues,
}: {
  clock: PlaybackClock;
  cues: readonly TranscriptCue[];
}) {
  const seconds = usePlaybackSeconds(clock);
  const cue = findActiveCue(cues, seconds);
  return cue ? <LiveCaption key={`${cue.start}`} text={cue.text} /> : null;
}

export function ClockedTranscriptDrawer({
  clock,
  ...props
}: Omit<Parameters<typeof TranscriptDrawer>[0], "currentTime"> & {
  clock: PlaybackClock;
}) {
  const seconds = usePlaybackSeconds(clock);
  return <TranscriptDrawer {...props} currentTime={seconds} />;
}
