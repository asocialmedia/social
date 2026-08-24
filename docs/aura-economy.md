# Aura Reputation Economy

Aura is the platform's reputation currency. This document describes how it is earned, lost, weighted, protected from farming, and consumed elsewhere. **Every tunable constant lives in one file: `packages/db/src/aura/config.ts`.** Nothing else may hardcode an aura amount.

## Model

- `User.aura` - the lifetime balance. Displayed on profiles, drives legacy rankings. All weighting happens here.
- `Post.aura` / `Comment.aura` - raw net vote counters (-1/+1 per vote). They drive UI display and trending inputs and are deliberately NOT weighted.
- `AuraLog` - the ledger. Every non-zero mutation writes a row carrying who caused it (`issuerId`), whose balance moved (`userId`), who the action targeted (`targetUserId`), what happened (`type`), where (`postId`/`commentId`), and `amount`. There are no silent adjustments; zero deltas write no row because there is no point to trace.
- Open positions - each relation stores exactly what it currently applied (`Vote.awardedAura`, `Vote.mutingCostAura`, `Bookmark.bookmarkerAura`, `Bookmark.authorAura`, `Follow.gainedAura`, `Follow.givenAura`, `Comment.creationAura`, `Comment.receivedAura`). Removals reverse EXACTLY these stored amounts - never recomputed. Rows created before this economy shipped carry zeros and reverse nothing (conservative under-refund).

## The award pipeline

Interpersonal awards run through `applyWeightedAward` (`packages/db/src/aura/ledger.ts`):

```
amount = base x credibility(actor) x pairTaper(actor->recipient) x dailyCap(recipient)
gains round DOWN, losses round UP (toward zero) - tuning mistakes under-deliver rather than over-punish
```

Participation stipends (post/comment creation, bookmark-given, follow-given) skip weighting via `applyFlatAward` but still face the daily cap. Attention milestones (views, shares) bypass everything - they are aggregate audience signals, not attributable actions.

## Constants (all in `packages/db/src/aura/config.ts`)

### Credibility -> influence

| Constant | Value | Meaning |
| --- | --- | --- |
| `NEW_ACCOUNT_MATURITY_DAYS` | 90 | Days until full age credit |
| `VETERAN_AURA` | 10,000 | Lifetime aura at which the aura half saturates (log scale) |
| `AGE_FACTOR_SHARE` | 0.5 | Weight of age vs aura in credibility |
| `CREDIBILITY_FLOOR` | 0.25 | Minimum influence fraction for any account |

`credibility = floor + (1-floor) x (0.5 x ageFactor + 0.5 x auraFactor)`. A brand-new account moves author balances by ~nothing; a mature, high-aura account at full price. Negative balances contribute zero to the aura half but never subtract - recovery earning happens at normal rates.

### Base awards (pre-weight)

| Action | Constant | Base |
| --- | --- | --- |
| Amplify received (post or comment) | `AMPLIFY_RECEIVE_AURA` | +3 |
| Mute received (post or comment) | `MUTE_RECEIVE_AURA` | -3 |
| Muter honesty cost (every mute, refunded on un-mute) | `MUTING_COST_AURA` | -1 |
| Comment posted | `COMMENT_CREATION_AURA` | +1 flat |
| Comment received on your post/thread | `COMMENT_RECEIVED_AURA` | +2 |
| Gaining a follower | `FOLLOW_GAINED_AURA` | +4 |
| Following someone | `FOLLOW_GIVEN_AURA` | +1 flat |
| Bookmarking someone's post (curator) | `BOOKMARK_GIVEN_AURA` | +1 flat |
| Your post bookmarked (author) | `BOOKMARK_RECEIVED_AURA` | +4 |
| Post / gust created | `POST_CREATION_AURA` | +10 flat |
| HN story share bonus | `HN_SHARE_BONUS_AURA` | +15 |
| Attachment bonuses | `ATTACHMENT_BONUSES` | per-type base/perItem/max |
| Post creation ceiling | `POST_CREATION_MAX_AURA` | 150 |
| View milestones | `VIEW_MILESTONE_*` | +10 / 50 views, +100 bonus / 1000 views |
| Share milestones | `SHARE_MILESTONE_TIERS` | 25 shares -> +10, 250 -> +50 |
| Moderation penalty (one-way, never refunded) | `MODERATION_PENALTY_AURA` | -100 |

Deliberate zeros / exclusions (documented decisions):

- Self-engagement (amplifying/muting/commenting on your own content) earns nothing for anyone. Self-mutes still cost the muter.
- Shares carry no per-user actor, so they award via aggregate milestones only.
- Attention milestones bypass weighting/tapering/capping by design.

### Anti-farm

| Knob | Value | Effect |
| --- | --- | --- |
| `PAIR_TAPER_WINDOW_DAYS` | 30 | Window for repeat-interaction counting |
| `PAIR_TAPER_DIVISOR` | 3 | factor(n) = 1/(1+n/3): 2nd interaction 0.75, 3rd 0.6, ... |
| `PAIR_TAPER_MIN_FACTOR` | 0.2 | Floor for long-term genuine pairs |
| `DAILY_INCOME_CAP` | 120 | Soft UTC-daily cap on positive interpersonal + creation income |
| `DAILY_CAP_FLOOR_RATIO` | 0.15 | Past the cap the rate decays as CAP/income, floored here |

Ring math (verified in `packages/db/src/aura/abuse-scenarios.test.ts`): 20 fresh accounts mutually amplifying earn literally zero; industrial propping plateaus near `base x DAILY_INCOME_CAP` no matter how many accounts join; repeat pair spam collapses under the taper.

### Negative aura

`visibilityWeight(aura) = aura >= 0 ? 1 : max(0.4, 1 + aura/2500)` (`VISIBILITY_WEIGHT_FLOOR`, `VISIBILITY_NEGATIVE_DIVISOR`). Soft ranking consequence only - nothing anywhere blocks on aura sign. Recovery is inherent: the weight recomputes from lifetime balance, so digging out restores reach.

## Momentum signal

`computeMomentum` folds the trailing ledger through recency buckets (`MOMENTUM_BUCKETS`: <=48h x1, <=7d x0.5, <=14d x0.25). Penalties drag recent momentum down. Derived from history, so it needs no backfill.

## Interface contract (feed/trending consumers)

Exported from `@asm/db`:

```ts
interface AuraSignals {
  credibility: number;      // 0..1 actor influence
  lifetimeAura: number;     // mirrors User.aura
  momentum: number;         // recency-weighted recent earnings, may be negative
  visibilityWeight: number; // 0.4..1 surfacing multiplier
}
getAuraSignals(userId): Promise<AuraSignals | null>        // redis-cached (60s TTL), fail-open
getAuraSignalsForUsers(userIds): Promise<Map<string, AuraSignals>> // capped at 200 users/call
invalidateAuraSignals(userIds): Promise<void>              // best-effort post-commit refresh
computeVisibilityWeight(lifetimeAura): number              // pure, batch-friendly
```

Consumers: the For-You ranker scales each candidate's final score by the author's `visibilityWeight`; `getAuraSignals().momentum` is available to any "hot right now" surface without recomputing from the ledger.

## Migration story

- Existing balances are untouched; only future awards change shape.
- Existing ledger rows stay valid: reversals use stored positions, and legacy rows default to zero positions (inert on removal).
- Momentum backfills itself from historical ledger rows.
- Optional one-time SQL backfills (not required, closes conservative gaps): set `votes.awardedAura = value` for pre-launch votes and mirror flat values onto `follows/bookmarks/comments` position columns if exact legacy reversal is ever wanted.
