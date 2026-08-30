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
  // Mirrors packages/db/src/aura/config.ts so aura math over attachments
  // behaves like production (calculateAuraReward reads base/perItem/max).
  ATTACHMENT_BONUSES: {
    AUDIO: { base: 25, max: 16, perItem: 8 },
    IMAGE: { base: 20, max: 25, perItem: 5 },
    VIDEO: { base: 40, max: 20, perItem: 10 },
  },
  BADGES: ["author", "dev", "early", "shitposter"],
  BadgeLimitError,
  HN_SHARE_BONUS_AURA: 15,
  MENTION_RECEIVED_AURA: 10,
  POST_CREATION_AURA: 10,
  POST_CREATION_MAX_AURA: 150,
  POST_VIEWS_KEY_PREFIX: "post:views:",
  POST_VIEWS_SET: "posts:with:views",
  SYSTEM_MODERATION_USER_ID: "sys-zeph",
  applyModerationPenalty: () => Promise.resolve(),
  cancelMediaCleanup: () => Promise.resolve(),
  enqueueNotificationCreated: () => Promise.resolve(),
  enqueuePostDeleted: () => Promise.resolve(),
  enqueueShitposterCheck: () => Promise.resolve(),
  getPostDataInclude: () => ({ user: true }),
  grantBadge: () => Promise.resolve(true),
  invalidateAuraSignals: () => Promise.resolve(),
  postViewsCache: {},
  revokeBadge: () => Promise.resolve(true),
  tagCache: {},
  userCache: {},
};
