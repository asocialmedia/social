export type EngagementEventType =
  | "IMPRESSION"
  | "VIEW_START"
  | "VIEW_COMPLETE"
  | "DWELL"
  | "SKIP"
  | "BUFFER"
  | "PLAYBACK_STARTUP"
  | "PLAYBACK_ERROR";
export interface EngagementEvent {
  eventType: EngagementEventType;
  durationMs?: number;
}
export interface EngagementSample {
  visible: boolean;
  foreground: boolean;
  video: boolean;
  playing?: boolean;
  buffering?: boolean;
  failed?: boolean;
  position?: number;
  duration?: number;
}

// Both clients count foreground visibility and advancing playback, never timers alone.
export class EngagementSession {
  private previous: EngagementSample | null = null;
  private lastAt: number | null = null;
  private visibleMs = 0;
  private watchedMs = 0;
  private playedMs = 0;
  private dwellMs = 0;
  private bufferMs = 0;
  private impressed = false;
  private started = false;
  private completed = false;
  private failed = false;
  private skipEmitted = false;
  private totalBufferMs = 0;
  private startupMs = 0;
  private startupEmitted = false;
  private readonly emit: (event: EngagementEvent) => void;
  readonly postId?: string;
  constructor(emit: (event: EngagementEvent) => void, postId?: string) {
    this.emit = emit;
    this.postId = postId;
  }

  sample(state: EngagementSample, now: number): void {
    const { previous } = this;
    const elapsed =
      this.lastAt === null ? 0 : Math.max(0, Math.min(2000, now - this.lastAt));
    const eligible = state.visible && state.foreground;
    const wasEligible = previous?.visible && previous.foreground;
    if (eligible && wasEligible) {
      this.visibleMs += elapsed;
      if (state.video && !this.startupEmitted) {
        this.startupMs += elapsed;
      }
      if (state.buffering && previous?.buffering) {
        this.bufferMs += elapsed;
        this.totalBufferMs += elapsed;
      }
      const positionDelta =
        ((state.position ?? 0) - (previous?.position ?? 0)) * 1000;
      const advancing =
        state.playing &&
        previous?.playing &&
        !state.buffering &&
        !previous?.buffering &&
        !state.failed &&
        positionDelta > 0 &&
        positionDelta <= elapsed * 4 + 500;
      let qualified = elapsed;
      if (state.video) {
        qualified = advancing ? Math.min(elapsed, positionDelta) : 0;
      }
      if (state.video && qualified > 0 && !this.startupEmitted) {
        this.startupEmitted = true;
        this.emit({
          durationMs: Math.round(this.startupMs),
          eventType: "PLAYBACK_STARTUP",
        });
      }
      this.watchedMs += qualified;
      if (state.video && advancing) {
        this.playedMs += positionDelta;
      }
      this.dwellMs += qualified;
    } else if (!eligible) {
      this.visibleMs = 0;
    }
    if (eligible && !this.impressed && this.visibleMs >= 1000) {
      this.impressed = true;
      this.emit({ eventType: "IMPRESSION" });
    }
    if (this.impressed && !this.started && this.watchedMs > 0) {
      this.started = true;
      this.emit({ eventType: "VIEW_START" });
    }
    if (eligible && state.failed && !this.failed) {
      this.failed = true;
      this.emit({ eventType: "PLAYBACK_ERROR" });
    }
    const durationMs = (state.duration ?? 0) * 1000;
    if (
      state.video &&
      durationMs > 0 &&
      !this.completed &&
      this.playedMs >= durationMs * 0.9 &&
      (state.position ?? 0) >= (state.duration ?? 0) * 0.9
    ) {
      this.completed = true;
      this.emit({
        durationMs: Math.round(this.watchedMs),
        eventType: "VIEW_COMPLETE",
      });
    }
    this.previous = { ...state };
    this.lastAt = now;
  }

  stop(leaving = true): void {
    if (this.impressed && this.dwellMs > 0) {
      this.emit({ durationMs: Math.round(this.dwellMs), eventType: "DWELL" });
    }
    if (this.bufferMs > 0) {
      this.emit({ durationMs: Math.round(this.bufferMs), eventType: "BUFFER" });
    }
    if (
      leaving &&
      this.impressed &&
      this.started &&
      !this.failed &&
      !this.skipEmitted &&
      this.watchedMs < 1500 &&
      this.totalBufferMs <= this.watchedMs
    ) {
      this.skipEmitted = true;
      this.emit({ durationMs: Math.round(this.watchedMs), eventType: "SKIP" });
    }
    this.dwellMs = 0;
    this.bufferMs = 0;
    this.previous = null;
    this.lastAt = null;
    this.visibleMs = 0;
  }
}
