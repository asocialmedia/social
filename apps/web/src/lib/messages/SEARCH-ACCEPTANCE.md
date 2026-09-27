# DM search: browser acceptance runbook

The unit suite cannot tell you whether search works. It runs against `fake-indexeddb` and the in-memory backend, and neither has the write lock, the structured-clone cost, or the request budget that decide how search feels on a fresh device. `scripts/bench-index-against-seed.ts` proves the model is right; it cannot prove the browser is fast.

This is the checklist that closes that gap. It is written as assertions with expected values, not as "click around and see", because the failure modes are exactly the ones that look fine until you measure them.

## Why it is a runbook and not a test

There is no browser automation in this repo, and adding one is a decision with a dependency and a CI-cost tail that is not ours to make. So this is a procedure a person (or an agent with browser access) runs against a real profile, and it names the assertion for each step so a result is a fact rather than an impression.

When an agent with browser tooling runs it, record the values next to each step. A step that cannot be asserted is a step that is not covered.

## Setup

- **Target**: a conversation of at least 200,000 messages. `bun run seed:dm --conversation=<id>` builds one; `scripts/seed-dm-history.ts` is deterministic (seed `20260925`) and plants the rare needles `zarquon`, `veldrith` and `obsidiancascade` in about 8% of messages.
- **Device**: record it. A phone-class device is the one that matters most, because the budgets below are set by what a phone can afford.
- **Fresh index**: open DevTools, run `indexedDB.deleteDatabase("asm-messages")`, and reload. Deleting the whole database also removes identity keys, so this doubles as a check that a fresh device can re-provision without a user-facing secret.
- **Quiet network**: do not run two passes back to back. The history endpoint is rate limited, and a throttled second pass produces false failures that look like product bugs.

## Step 1: fresh device, search opens, walk starts

Open the conversation, open search, type `zarquon`.

| Assert          | Expected                                        | Budget |
| --------------- | ----------------------------------------------- | ------ |
| Identity status | reaches ready without a user-facing secret      | —      |
| First results   | appear, with real preview text                  | < 2s   |
| Coverage line   | `Indexing older messages (N indexed)`, N rising | —      |
| Counter         | `1 of M so far`, M exact and rising             | —      |
| Console         | zero errors                                     | 0      |
| Long tasks      | no task > 100ms during the first 10s            | 0      |

`M so far` rather than `M` is correct and expected here: coverage is partial, and the qualifier is the honest wording. A bare `M` while the walk is running would be a bug.

## Step 2: the list pages through everything

Switch to the list view.

| Assert | Expected | Budget |
| --- | --- | --- |
| Page 1 | counter `1–20 of M`, twenty rows rendered | — |
| Page 2 | counter `21–40 of M`, twenty rows rendered | < 500ms |
| Every page | counter advances by exactly 20, no page short except the last | < 500ms each |
| Last page | `Next page` disabled | — |
| Duplicates | none, checked by **message id** | 0 |
| Gaps | none: pages 1..N cover ranks 1..M exactly once | 0 |
| Empty states | never `No messages match this search` while M > 0 | 0 |
| Failures | never `This page could not be loaded` | 0 |

The duplicate and gap checks must be by message id, not by rendered text. The seeded conversation repeats the same sentences many times, so a text-based check reports hundreds of false duplicates.

`BROWSER_PAGE_TURN_SLO_MS` (500ms) is the per-turn budget. It is set by the CONTENDED case, measured at 178–452ms while a backfill was committing — a settled index measures 81–164ms. A turn slower than 500ms with a walk running is a regression against the write-lock budget, not against the query.

## Step 3: chat navigation past the third match

This is the "loading messages" report. Press the next-match chevron one at a time, waiting for each to settle.

| Assert | Expected | Budget |
| --- | --- | --- |
| Presses 1..8 past match 3 | every press lands; the counter advances by one | < 1500ms each |
| Badge | appears at most once per press, and only while a read is genuinely in flight | — |
| Badge flicker | the label does not alternate within one press | 0 |
| Landed bubble | shows decrypted text | always |
| Empty bubbles | none on the landed row | 0 |
| False failure | never `Couldn't load that message` for a reachable match | 0 |

Mashing the arrows is a different case and each press legitimately supersedes the last. Measure it separately; it is not this assertion.

## Step 4: honest failure

Sign the session out, or expire it, then press the chevron.

| Assert       | Expected                                                   |
| ------------ | ---------------------------------------------------------- |
| Read refused | names the session or the connection, not a missing message |
| Walk         | stops, and the coverage line does not claim completion     |
| List         | keeps showing what it already has                          |
| Console      | no unhandled rejection                                     |

`Couldn't load that message` is only truthful after an anchored read AND a paced bounded walk both came up empty over real pages. A 401 or a 429 is not evidence that a message does not exist.

## Step 5: search close and reopen

| Assert               | Expected                                            |
| -------------------- | --------------------------------------------------- |
| Closing search       | stops the walk; no request after the close          |
| Reopening            | resumes from the persisted cursor, not from the top |
| Network while closed | quiet                                               |

## Step 6: conversation switch mid-jump

Start a jump, switch conversation before it lands.

| Assert | Expected |
| --- | --- |
| Old jump | lands silently; the new conversation's viewport is untouched |
| Loader badge | cleared, not left spinning |
| History reads | the new conversation's, never the old one's cursors |
| New conversation's auto fill | not suppressed for a failure the old one had |

## Step 7: hidden tab

Open search, let the walk start, switch tabs for 30 seconds.

| Assert    | Expected                                     |
| --------- | -------------------------------------------- |
| Walk      | pauses; no history requests while hidden     |
| On return | resumes automatically, no user action        |
| Counter   | resumes from where it stopped, not from zero |

## Step 8: storage

| Assert | Expected |
| --- | --- |
| IndexedDB size after a full walk | record it; compare against `ESTIMATED_INDEX_BYTES_PER_200K_ROWS` in `search-slo.ts` |
| Origin storage | within the browser's per-origin budget with room to spare |
| Second conversation | indexed without the first being evicted |
| Third, oversized | the LRU conversation is evicted, and the ACTIVE one never is |
| Full disk | the walk stops, coverage stays honest, search over loaded rows still works |

Step 8 is where `SEARCH_INDEX_BYTES_PER_ROW` gets its real number. It currently assumes 92 bytes per row, measured before format 7 added a creation time beside every posting. The assumption errs LOW, which is the safe direction — it evicts sooner than it must — but the magnitude is unverified.

## Step 9: identity is untouched

Delete the database, reload, and confirm the conversation decrypts.

| Assert       | Expected                                         |
| ------------ | ------------------------------------------------ |
| Recovery     | automatic, from the stored identity row          |
| User input   | none requested: no passphrase, no passkey prompt |
| Search index | rebuilt by walking, not by a prompt              |

The index is derived data and is disposable. Identity material is not, and no search change may move it, reset it, or make it depend on anything the user can lose.

## Recording a result

```
device:            browser:
conversation size: fresh index: yes/no
SLOs measured:     query __ms | page turn __ms | jump __ms
failures:          step __ / expected __ / got __
```

A budget overrun is a performance bug and a wrong answer is a correctness bug. They get fixed by different people, and a run that reports one number for both is not a result.
