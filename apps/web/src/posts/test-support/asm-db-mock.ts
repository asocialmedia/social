export const EMBEDDING_DIMENSION = 384;

// Shared @asm/db mock surface for the posts/editor test suites. Both suites
// mock the barrel wholesale, so every export the modules under test (or any
// sibling suite batched into the same bun test run) read must exist in one
// place; each suite spreads this base and registers only its own overrides.
export class BadgeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadgeLimitError";
  }
}

export const asmDbMockBase = {
  AMPLIFY_RECEIVE_AURA: 3,
  // Mirrors packages/db/src/aura/config.ts so aura math over attachments
  // behaves like production (calculateAuraReward reads base/perItem/max).
  ATTACHMENT_BONUSES: {
    AUDIO: { base: 25, max: 16, perItem: 8 },
    IMAGE: { base: 20, max: 25, perItem: 5 },
    VIDEO: { base: 40, max: 20, perItem: 10 },
  },
  BADGES: ["author", "dev", "early", "shitposter"],
  BOOKMARK_GIVEN_AURA: 1,
  BOOKMARK_RECEIVED_AURA: 4,
  BadgeLimitError,
  COMMENT_CREATION_AURA: 1,
  COMMENT_RECEIVED_AURA: 1,
  EMBEDDING_DIMENSION,
  FOLLOW_GAINED_AURA: 10,
  FOLLOW_GIVEN_AURA: 1,
  HN_SHARE_BONUS_AURA: 15,
  MENTION_RECEIVED_AURA: 10,
  POST_CREATION_AURA: 10,
  POST_CREATION_MAX_AURA: 150,
  POST_VIEWS_KEY_PREFIX: "post:views:",
  POST_VIEWS_SET: "posts:with:views",
  RESPONSE_RECEIVED_AURA: 2,
  RESPONSE_RECEIVED_POST_AURA: 1,
  SYSTEM_MODERATION_USER_ID: "sys-zeph",
  applyFlatAward: () => Promise.resolve({ amount: 1 }),
  applyModerationPenalty: () => Promise.resolve(),
  applyWeightedAward: () => Promise.resolve({ amount: 1 }),
  canViewCommunity: () => Promise.resolve(true),
  canViewCommunityById: () => Promise.resolve(true),
  cancelMediaCleanup: () => Promise.resolve(),
  communityVisibilityWhere: () => ({}),
  enqueueMediaAnalyze: () => Promise.resolve(),
  enqueueNotificationCreated: () => Promise.resolve(),
  enqueueNotificationDeleted: () => Promise.resolve(),
  enqueuePostDeleted: () => Promise.resolve(),
  enqueueShitposterCheck: () => Promise.resolve(),
  generateLocalEmbedding: (): number[] =>
    Array.from({ length: EMBEDDING_DIMENSION ?? 384 }).fill(0) as number[],
  getCommentDataInclude: () => ({ user: true }),
  getCommunityRoleSelect: () => ({ select: { role: true } }),
  getPostDataInclude: () => ({ user: true }),
  getPrivateUserSelect: () => ({}),
  getPublicUserSelect: () => ({}),
  getUserDataSelect: () => ({}),
  grantBadge: () => Promise.resolve(true),
  invalidateAuraSignals: () => Promise.resolve(),
  invalidateCommunityPostAggregates: () => Promise.resolve(),
  invalidateCommunityStats: () => Promise.resolve(),
  invalidateFypProfile: () => Promise.resolve(),
  markUserOnline: () => Promise.resolve(),
  messageConversationInclude: {},
  notifyCommunitySubscribers: () => Promise.resolve([]),
  postViewsCache: {},
  publishCommentCreated: () => Promise.resolve(),
  publishCommentDeleted: () => Promise.resolve(),
  publishConversationRead: () => Promise.resolve(),
  publishMessageCreated: () => Promise.resolve(),
  publishResponseCreated: () => Promise.resolve(),
  publishResponseDeleted: () => Promise.resolve(),
  publishTrendingSnapshot: () => Promise.resolve(),
  publishTypingStarted: () => Promise.resolve(),
  redis: {
    del: () => Promise.resolve(),
    get: () => Promise.resolve(null),
    set: () => Promise.resolve("OK"),
    srem: () => Promise.resolve(),
  },
  reverseExactAura: () => Promise.resolve(),
  revokeBadge: () => Promise.resolve(true),
  schedulePublishedNotificationCleanup: () => Promise.resolve(),
  settleVoteTransition: () => Promise.resolve({ auraDelta: 0 }),
  tagCache: {},
  unreadMessageCache: {
    decrement: () => Promise.resolve(0),
    get: () => Promise.resolve(0),
    increment: () => Promise.resolve(1),
    reset: () => Promise.resolve(),
  },
  unreadNotificationCache: {
    decrement: () => Promise.resolve(0),
    get: () => Promise.resolve(0),
    increment: () => Promise.resolve(1),
    reset: () => Promise.resolve(),
  },
  userCache: {},
};
