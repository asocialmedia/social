// Every aura economy constant lives in this file. Nothing else in the
// codebase may hardcode an aura amount, weight, cap, or threshold - tune the
// economy here and nowhere else. Each block explains what the value buys so a
// adjustment never needs archaeology.
//
// Two invariants to preserve while tuning:
// 1. Gains are rounded DOWN and losses rounded UP (toward zero) by the engine,
//    so base amounts can stay integers even though weights are fractional.
// 2. Post.aura / Comment.aura remain raw net-vote counters (they drive UI
//    display and trending inputs). Weighting only ever applies to User.aura.

// ---------------------------------------------------------------------------
// Credibility -> influence weighting
// ---------------------------------------------------------------------------

// An account reaches full age-credibility after this many days. Before that,
// its engagement is weighted down regardless of how much aura it has bought
// or earned, which blunts sockpuppet rings.
export const NEW_ACCOUNT_MATURITY_DAYS = 90;

// Lifetime aura at which the aura half of credibility saturates (log scale).
// 10k keeps the curve generous: ~500 aura earns most of the credit.
export const VETERAN_AURA = 10_000;

// How much of credibility comes from account age vs lifetime aura. 0.5 makes
// a fresh account unable to buy influence quickly no matter its balance, and
// an old account unable to coast on history alone.
export const AGE_FACTOR_SHARE = 0.5;

// Minimum credibility for any non-banned account. Engagement from a day-old
// account is worth this fraction of a maximally credible account's. Kept
// above zero so genuine newcomers still participate (their votes count on
// posts; they just move user aura barely at all).
export const CREDIBILITY_FLOOR = 0.25;

// ---------------------------------------------------------------------------
// Base awards (before weighting, tapering, capping, rounding)
// ---------------------------------------------------------------------------

// Author award when someone amplifies (+1 vote) their post or comment.
// Was +1 flat for everyone; now scaled by actor credibility.
export const AMPLIFY_RECEIVE_AURA = 3;

// Author penalty when someone mutes (-1 vote) their post or comment. Kept
// equal in magnitude to the amplify gain so net scores stay meaningful;
// losses round toward zero, which softens them slightly in practice.
export const MUTE_RECEIVE_AURA = 3;

// Cost charged to the muter per mute, refunded exactly on un-mute. Small
// enough that honest downvoting is unaffected, large enough that mass-muting
// drains the muter instead of the target.
export const MUTING_COST_AURA = 1;

// Commenter's participation stipend. Deliberately NOT credibility-weighted:
// weighting your own earning by your own credibility entrenches
// rich-get-richer. The daily income cap bounds spam instead.
export const COMMENT_CREATION_AURA = 1;

// Post author award per comment (eddie) on their post, and per reply for
// both the parent-comment author and the post author. Cumulative: deep
// threads keep paying the author.
export const COMMENT_RECEIVED_AURA = 1;

// Post author award per response to their post from another user.
export const RESPONSE_RECEIVED_AURA = 2;

// Raw post aura increment when receiving a response from another user.
export const RESPONSE_RECEIVED_POST_AURA = 1;

// Followed user award when gaining a follower.
export const FOLLOW_GAINED_AURA = 10;

// Follower award for extending their network. Weighted like all engagement;
// the daily cap bounds follow-and-unfollow churn farming.
export const FOLLOW_GIVEN_AURA = 1;

// Bookmarker award for curating content.
export const BOOKMARK_GIVEN_AURA = 1;

// Author award when their post is bookmarked - the strongest deliberate
// signal, priced above an amplify.
export const BOOKMARK_RECEIVED_AURA = 4;

// Flat self-award for creating content (posts and gusts alike). Counts
// toward the daily income cap, so low-effort posting farms are bounded.
export const POST_CREATION_AURA = 10;

// HN story share bonus (existing behavior, centralized here).
export const HN_SHARE_BONUS_AURA = 15;

// Attachment bonus curve for post creation (existing behavior, centralized).
// Per-type base plus per-item bonus, capped per type.
export const ATTACHMENT_BONUSES = {
  AUDIO: { base: 25, max: 16, perItem: 8 },
  IMAGE: { base: 20, max: 25, perItem: 5 },
  VIDEO: { base: 40, max: 20, perItem: 10 },
} as const;

// Total post-creation award ceiling including all bonuses.
export const POST_CREATION_MAX_AURA = 150;

// One-time flat award to the creator when a community is founded. Superseded
// by the escalating COMMUNITY_FOUNDING_BONUSES ladder, which lives in
// communities/constants.ts (it is a community-domain rule the client wizard
// also reads, so it sits on the client-safe entry point). This constant is kept
// only so legacy ledger rows written with it stay explainable.
export const COMMUNITY_CREATED_AURA = 25;

// ---------------------------------------------------------------------------
// Community join bonus
// ---------------------------------------------------------------------------
// Joining a community pays the joiner once per community, and pays that
// community's owner a smaller thank-you per new member. Both are one-time per
// (community, user) pair, recorded in CommunityJoinBonus; the unique
// constraint there is the durable guard, so leave/rejoin cannot re-farm.
//
// The joiner amount is large relative to the daily cap on purpose: it is a
// welcome gift, and its one-time-ness is what bounds it, not the cap. To keep
// that bounded in practice the award is gated on the joining account's own
// age (COMMUNITY_JOIN_MIN_ACCOUNT_AGE_DAYS) and on a rolling daily ceiling
// (COMMUNITY_JOIN_DAILY_AURA_CAP) so an account cannot sweep hundreds of
// communities in one sitting and convert them all to aura at once.
export const COMMUNITY_JOIN_AURA = 150;
export const COMMUNITY_JOIN_OWNER_AURA = 1;

// The joiner must have an account at least this old to be paid the welcome
// gift. Joining itself is never blocked - a brand-new account can still become
// a member, it simply is not paid until it has some history. This is the
// sybil cost: a freshly minted account cannot immediately convert a join into
// aura, so a farm has to age every throwaway account it makes.
export const COMMUNITY_JOIN_MIN_ACCOUNT_AGE_DAYS = 7;

// Maximum join-bonus aura a single account can earn per UTC day. Reaching it
// does not block joining (membership still succeeds); it only stops paying.
// At 150/join this is 6 paid joins/day, which comfortably covers genuine
// exploration while making a sweep of the directory unprofitable.
export const COMMUNITY_JOIN_DAILY_AURA_CAP = 1000;

// ---------------------------------------------------------------------------
// Community standing (the founding credential)
// ---------------------------------------------------------------------------
// Aura is the reward currency: it is deliberately uncapped for viral reach so a
// breakout post pays off fully, and it drives the flame, leaderboards and every
// other score in the app. Community founding gates on a SEPARATE, derived
// quantity called standing, so one lucky post cannot buy a permanent
// credential.
//
// standing = (all earned aura, excluding attention milestones and founding
//             bonuses)
//          + min(total attention-milestone aura, REACH_ALLOWANCE)
//
// Reach therefore still counts toward founding - going viral toward your first
// community feels rewarded - but it saturates at this allowance. The higher
// bars can only be cleared by the capped, sustained income that
// DAILY_INCOME_CAP already bounds, which is what makes the credential mean
// "sustained contribution" rather than "got lucky once" or "already founded
// things".
export const COMMUNITY_REACH_ALLOWANCE = 1000;

// Ledger types that pay for aggregate audience attention (views, shares)
// rather than a deliberate peer interaction. These are the awards that bypass
// the daily income cap, so they are the ones that must be bounded for standing.
// Platform recognition (TRENDING_APPEARANCE) is deliberately NOT here: it is
// already deduped to once per user per UTC day and only fires for accounts
// consistently near the top, so it is a sustained signal and stays in standing
// in full.
export const ATTENTION_MILESTONE_TYPES = [
  "POST_VIEWS_MILESTONE",
  "SHARE_MILESTONE",
] as const;

// Positive award types that never count toward standing: attention milestones
// (bounded by the reach allowance above), community founding bonuses (which
// would otherwise fund their own next tier), and the community join bonus
// (otherwise joining a hundred communities would buy the whole founding ladder
// outright). Everything else earned counts in full.
export const STANDING_EXCLUDED_TYPES = [
  ...ATTENTION_MILESTONE_TYPES,
  "COMMUNITY_CREATED",
  "COMMUNITY_JOIN",
] as const;

// ---------------------------------------------------------------------------
// View & share attention milestones
// ---------------------------------------------------------------------------
// Attention is attributed to aggregate audiences, not single accounts, so
// milestone awards skip weighting/tapering/capping entirely and are the only
// positive awards allowed to bypass the daily income cap.

// View milestones: steady accrual (+1 per full 10 views) plus one-shot
// bonus tiers alongside (1K -> +100, 10K -> +1000). Add tiers to grow the
// ladder - they must be sorted ascending.
export const VIEW_MILESTONE_STEP_VIEWS = 10;
export const VIEW_MILESTONE_STEP_AURA = 1;
export const VIEW_BONUS_TIERS = [
  { aura: 100, threshold: 1000 },
  { aura: 1000, threshold: 10_000 },
] as const;

// Appearing in the trending users card pays a flat profile award, deduped
// to once per user per UTC day so repeated sidebar loads cannot re-print it.
export const TRENDING_CARD_AURA = 100;

// Being mentioned in a post pays the mentioned user. Unique per
// (post, mentioned user) by schema, and subject to the receiver's daily cap.
export const MENTION_RECEIVED_AURA = 10;

// Share milestones are one-shot superlinear tiers (shares lack the steady
// cadence views have): crossing each threshold grants `aura` once. Sorted
// ascending.
export const SHARE_MILESTONE_TIERS = [
  { aura: 10, threshold: 25 },
  { aura: 50, threshold: 250 },
] as const;

// ---------------------------------------------------------------------------
// Anti-farm: pairwise tapering
// ---------------------------------------------------------------------------

// Repeat interactions of the same class between the same two accounts decay
// as factor(n) = 1 / (1 + n / PAIR_TAPER_DIVISOR), where n counts prior
// interactions of that class inside PAIR_TAPER_WINDOW_DAYS. At the default
// divisor: 1st interaction 1.0, 2nd 0.75, 3rd 0.6, 6th ~0.33.
export const PAIR_TAPER_WINDOW_DAYS = 30;
export const PAIR_TAPER_DIVISOR = 3;

// Floor for the taper so long-term genuine pairs never fall below this
// fraction of a full award.
export const PAIR_TAPER_MIN_FACTOR = 0.2;

// Interaction classes that share a taper counter. Votes on posts and comments
// taper together per pair; bookmarks, follows, and received-comments each
// have their own counters because they are different social currencies.
export const TAPER_CLASSES = {
  amplify: ["POST_VOTE", "COMMENT_VOTE"],
  bookmark: ["POST_BOOKMARKED", "POST_BOOKMARK_RECEIVED"],
  commentReceived: ["COMMENT_RECEIVED"],
  follow: ["FOLLOW_GAINED", "FOLLOW_GIVEN"],
} as const;

// ---------------------------------------------------------------------------
// Anti-farm: daily income cap (ring damping)
// ---------------------------------------------------------------------------

// Soft cap on positive interpersonal + creation income per UTC day. Beyond
// the cap the rate scales as CAP/income (halving at 2x, quarter at 4x),
// floored at DAILY_CAP_FLOOR_RATIO. Coordinated propping therefore hits
// sharply diminishing returns without ever hard-blocking honest heavy days.
// Attention milestones (views, shares) and moderation penalties bypass this.
export const DAILY_INCOME_CAP = 120;
export const DAILY_CAP_FLOOR_RATIO = 0.15;

// ---------------------------------------------------------------------------
// Negative aura: soft visibility consequences
// ---------------------------------------------------------------------------

// Multiplier other features may apply when surfacing a negative-balance
// user's content. Never blocks any action (no hard locks), just ranks lower.
// weight(aura) = max(FLOOR, 1 + aura / DIVISOR): -600 -> ~0.76, -1500+ -> 0.4.
// Recovery is inherent: the weight recomputes from lifetime balance, so
// digging out of debt restores visibility immediately.
export const VISIBILITY_WEIGHT_FLOOR = 0.4;
export const VISIBILITY_NEGATIVE_DIVISOR = 2500;

// ---------------------------------------------------------------------------
// Moderation (unchanged semantics, centralized)
// ---------------------------------------------------------------------------

// One-way penalty applied when content is moderated. Never refunded on
// unmoderation - moderation stays costly even if reversed.
export const MODERATION_PENALTY_AURA = 100;

// ---------------------------------------------------------------------------
// Momentum signal
// ---------------------------------------------------------------------------

// Recency buckets for the momentum signal: sum(ledger amounts x bucket
// weight) over the trailing window. Distinguishes "on fire this week" from
// "accumulated over years" without touching the lifetime balance.
export const MOMENTUM_BUCKETS = [
  { maxAgeHours: 48, weight: 1 },
  { maxAgeHours: 168, weight: 0.5 },
  { maxAgeHours: 336, weight: 0.25 },
] as const;

// Redis cache TTL for computed signals. Ledger writes also invalidate
// eagerly; the TTL is the correctness backstop.
export const SIGNALS_CACHE_TTL_SECONDS = 60;
export const SIGNALS_CACHE_KEY_PREFIX = "aura:signals";

// Batch size cap for getAuraSignalsForUsers; keeps the momentum scan bounded.
export const SIGNALS_BATCH_MAX_USERS = 200;
