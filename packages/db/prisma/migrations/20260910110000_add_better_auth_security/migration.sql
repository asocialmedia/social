ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "lastLoginMethod" TEXT;

CREATE TABLE IF NOT EXISTS "twoFactor" (
  "id" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "backupCodes" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT true,
  "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "twoFactor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "twoFactor_userId_key" ON "twoFactor"("userId");
CREATE INDEX IF NOT EXISTS "twoFactor_secret_idx" ON "twoFactor"("secret");

CREATE TABLE IF NOT EXISTS "passkey" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "credentialID" TEXT NOT NULL,
  "counter" INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "backedUp" BOOLEAN NOT NULL,
  "transports" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "aaguid" TEXT,

  CONSTRAINT "passkey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "passkey_credentialID_key" ON "passkey"("credentialID");
CREATE INDEX IF NOT EXISTS "passkey_userId_idx" ON "passkey"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'twoFactor_userId_fkey'
  ) THEN
    ALTER TABLE "twoFactor"
      ADD CONSTRAINT "twoFactor_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'passkey_userId_fkey'
  ) THEN
    ALTER TABLE "passkey"
      ADD CONSTRAINT "passkey_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
