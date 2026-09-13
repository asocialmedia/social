-- CreateIndex
CREATE INDEX IF NOT EXISTS "notifications_issuerId_type_createdAt_idx"
  ON "notifications"("issuerId", "type", "createdAt");
