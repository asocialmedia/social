-- Message edits.
--
-- A sender may rewrite a message's ciphertext within a short window after
-- sending. The row is updated in place: the ratchet index is part of the
-- derived message key and the per-sender index sequence is dense, so an edit
-- MUST re-encrypt under the same (rootKey, senderId, ratchetIndex) with a fresh
-- IV rather than minting a new index. `editedAt` records the rewrite so the UI
-- can mark the bubble and the 12-hour window can be enforced from the row
-- alone (no client clock trust).
--
-- Purely additive: one nullable timestamp column. PostgreSQL stores a NULL
-- default as a metadata-only change (no table rewrite, no long lock) even on a
-- large `messages` table. Safe to apply inside or outside a transaction.

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);