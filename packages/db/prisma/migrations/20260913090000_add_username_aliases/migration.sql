CREATE TABLE IF NOT EXISTS "username_aliases" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "username_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "username_aliases_username_key"
  ON "username_aliases"("username");

CREATE UNIQUE INDEX IF NOT EXISTS "username_aliases_lower_username_key"
  ON "username_aliases"(LOWER("username"));

CREATE INDEX IF NOT EXISTS "username_aliases_expiresAt_idx"
  ON "username_aliases"("expiresAt");

CREATE INDEX IF NOT EXISTS "username_aliases_userId_createdAt_idx"
  ON "username_aliases"("userId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'username_aliases_userId_fkey'
  ) THEN
    ALTER TABLE "username_aliases"
      ADD CONSTRAINT "username_aliases_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
