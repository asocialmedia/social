// Explicit form of the reel autoplay gate (gust-card.tsx): the card used to
// spread this across isActive/mountVideo/suspended/appActive/userPaused and
// wasPlaying refs, and any new flag had to re-derive the same truth table.
// This function is that table in one place: given the inputs, it returns the
// single player action plus the next ref values. `isPlaying` never appears
// here on purpose: whether the decoder is running is read back from player
// events, never stored alongside these inputs.
export interface GustPlaybackInputs {
  appActive: boolean;
  hasSource: boolean;
  isActive: boolean;
  revealed: boolean;
  suspended: boolean;
  userPaused: boolean;
  wasPlaying: boolean;
}

export interface GustPlaybackDecision {
  // What the caller should do to the player this pass.
  action: "hold" | "pause" | "play";
  // Leaving the window rewinds, like web's render-phase reset.
  rewind: boolean;
  nextUserPaused: boolean;
  nextWasPlaying: boolean;
}

export function resolveGustPlayback(
  inputs: GustPlaybackInputs
): GustPlaybackDecision {
  if (!inputs.hasSource) {
    return {
      action: "hold",
      nextUserPaused: inputs.userPaused,
      nextWasPlaying: inputs.wasPlaying,
      rewind: false,
    };
  }
  if (!inputs.isActive) {
    return {
      action: "pause",
      nextUserPaused: false,
      nextWasPlaying: inputs.wasPlaying,
      rewind: true,
    };
  }
  if (!inputs.appActive || inputs.suspended) {
    return {
      action: "pause",
      nextUserPaused: inputs.userPaused,
      // Only resumed when the hold interrupted actual playback: a tap-pause
      // before backgrounding stays paused on foreground.
      nextWasPlaying: true,
      rewind: false,
    };
  }
  const resume = inputs.wasPlaying;
  if (inputs.revealed && (!inputs.userPaused || resume)) {
    return {
      action: "play",
      nextUserPaused: false,
      nextWasPlaying: false,
      rewind: false,
    };
  }
  return {
    action: "hold",
    nextUserPaused: inputs.userPaused,
    nextWasPlaying: false,
    rewind: false,
  };
}
