interface GlobalMessageSearchViewState {
  conversationType?: "ALL" | "DM" | "DEN";
  profilesExpanded?: boolean;
  query: string;
  scrollTop: number;
  selectedMessageId: string;
}

interface SavedGlobalMessageSearchViewState {
  expiresAt: number;
  state: GlobalMessageSearchViewState;
}

const MAX_SAVED_VIEWS = 8;
const SAVED_VIEW_TTL_MS = 2 * 60 * 1000;
const savedViews = new Map<string, SavedGlobalMessageSearchViewState>();

export function saveGlobalMessageSearchViewState(
  userId: string,
  state: GlobalMessageSearchViewState
): void {
  if (!userId || !state.query || !state.selectedMessageId) {
    return;
  }
  savedViews.delete(userId);
  while (savedViews.size >= MAX_SAVED_VIEWS) {
    const oldestUserId = savedViews.keys().next().value;
    if (oldestUserId === undefined) {
      break;
    }
    savedViews.delete(oldestUserId);
  }
  savedViews.set(userId, {
    expiresAt: Date.now() + SAVED_VIEW_TTL_MS,
    state: {
      conversationType: state.conversationType,
      profilesExpanded: state.profilesExpanded,
      query: state.query,
      scrollTop: Math.max(0, state.scrollTop),
      selectedMessageId: state.selectedMessageId,
    },
  });
}

export function takeGlobalMessageSearchViewState(
  userId: string
): GlobalMessageSearchViewState | null {
  const state = peekGlobalMessageSearchViewState(userId);
  savedViews.delete(userId);
  return state;
}

export function peekGlobalMessageSearchViewState(
  userId: string
): GlobalMessageSearchViewState | null {
  const saved = savedViews.get(userId);
  if (!saved || saved.expiresAt <= Date.now()) {
    savedViews.delete(userId);
    return null;
  }
  return saved.state;
}

export function clearGlobalMessageSearchViewState(userId: string): void {
  savedViews.delete(userId);
}
