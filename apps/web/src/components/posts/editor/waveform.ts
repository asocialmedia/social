// Waveform extraction for the composer's audio visualizer. Lives outside the
// component so the math is unit-testable.

// Dense SoundCloud-style equalizer resolution for the audio visualizer:
// fine enough to read as a waveform, coarse enough that played/unplayed
// coloring stays legible on a seek bar.
export const EQ_BAR_COUNT = 80;

// Fallback profile (0..1 fractions) shown while the real waveform is being
// decoded; replaced as soon as the audio file yields its peaks. Values are
// fractions on purpose - the bars render `height * 100%`.
export const EQ_FALLBACK_HEIGHTS: number[] = Array.from(
  { length: EQ_BAR_COUNT },
  (_, index) => (30 + ((index * 37) % 55)) / 100
);

// Per-bar amplitudes from the actual audio samples. RMS per bucket (not
// peak) so a mastered track shows real shape instead of a full-height wall,
// then normalized against the track's own loudest bucket so quiet passages
// still read. Floored so silence never collapses, capped so the playing
// animation never overflows the container.
export function extractWaveform(
  channel: Float32Array,
  barCount: number
): number[] {
  const blockSize = Math.max(1, Math.floor(channel.length / barCount));
  const rms: number[] = [];
  for (let bar = 0; bar < barCount; bar += 1) {
    let sum = 0;
    const start = bar * blockSize;
    const end = Math.min(channel.length, start + blockSize);
    for (let sample = start; sample < end; sample += 1) {
      sum += channel[sample] * channel[sample];
    }
    rms.push(Math.sqrt(sum / (end - start)));
  }
  const maxRms = Math.max(...rms, 1e-6);
  return rms.map((value) => {
    const shaped = Math.sqrt(value / maxRms);
    return Math.max(0.12, Math.min(0.85, shaped * 0.75 + 0.1));
  });
}
