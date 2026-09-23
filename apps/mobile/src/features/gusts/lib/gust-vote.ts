// Gust vote transitions, ported from web's use-gust-vote: the rail's up and
// down buttons toggle (tapping the active value clears it with DELETE), and
// the double tap is a forced +1 that never un-amplifies and stays silent.
// Optimistic aura moves by the vote delta, like web's calculateVoteChange.

export interface GustVoteState {
  aura: number;
  userVote: number;
}

export interface GustVotePlan {
  next: GustVoteState;
  // No request at all: a double tap on an already amplified gust.
  noop: boolean;
  target: -1 | 0 | 1;
  toggleOff: boolean;
}

export function planGustVote(
  current: GustVoteState,
  value: 1 | -1,
  forced = false
): GustVotePlan {
  if (forced && current.userVote === value) {
    return { next: current, noop: true, target: value, toggleOff: false };
  }
  const toggleOff = !forced && current.userVote === value;
  const target = toggleOff ? 0 : value;
  return {
    next: {
      aura: current.aura + (target - current.userVote),
      userVote: target,
    },
    noop: false,
    target,
    toggleOff,
  };
}

export interface GustVoteToast {
  description: string;
  title: string;
}

// Web's toast copy after a rail vote. The double tap passes forced plans,
// which toast nothing; clearing a vote names what was removed.
export function gustVoteToast(
  plan: GustVotePlan,
  previousVote: number,
  authorName: string
): GustVoteToast | null {
  if (plan.noop) {
    return null;
  }
  if (plan.toggleOff) {
    return previousVote === 1
      ? {
          description: "You can always amplify it again later",
          title: "Amplification Removed",
        }
      : {
          description: "It'll show up normally again",
          title: "Mute Removed",
        };
  }
  if (plan.target === 1) {
    return {
      description: `Amplified ${authorName}'s gust, nice boost!`,
      title: "+1 Aura",
    };
  }
  return {
    description: `Muted ${authorName}'s gust, we'll show you fewer like this`,
    title: "Muted",
  };
}

export const GUST_VOTE_ERROR_COPY =
  "That didn't go through, give it another try?";
