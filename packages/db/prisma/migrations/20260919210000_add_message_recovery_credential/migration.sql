-- WebAuthn credential used solely to recover the messages backup on a new
-- device. Purely additive: a brand-new table, so the standard sync path
-- (docker/prisma-sync.sh) applies it without any special handling.
--
-- Deliberately separate from `passkey` so removing a sign-in method cannot
-- silently destroy E2EE recovery. The PRF output that derives the backup key
-- never reaches the server; only the public key and counter are stored.

-- CreateTable
CREATE TABLE "message_recovery_credentials" (
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_recovery_credentials_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_recovery_credentials_credentialId_key" ON "message_recovery_credentials"("credentialId");

-- AddForeignKey
ALTER TABLE "message_recovery_credentials" ADD CONSTRAINT "message_recovery_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Dual backup: keep the manual-secret copy and add a PRF copy alongside it, so
-- enrolling a passkey can never lock out a device that only holds the secret.
-- Both are nullable (existing rows have neither) and hold ciphertext only.
ALTER TABLE "message_identities" ADD COLUMN IF NOT EXISTS "prfEncryptedPrivateKey" TEXT;
ALTER TABLE "message_identities" ADD COLUMN IF NOT EXISTS "prfVerifier" TEXT;
