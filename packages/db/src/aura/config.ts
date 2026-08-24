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
