// query: extracted.statement1
SET lock_timeout='5s'
// query: extracted.statement2
ALTER TABLE IF EXISTS public.messages ADD COLUMN IF NOT EXISTS "expiresAt" timestamp(3)
// query: extracted.statement3
ALTER TABLE IF EXISTS public.post_media ADD COLUMN IF NOT EXISTS "incognitoSessionId" text
// query: extracted.statement4
ALTER TABLE IF EXISTS public.message_media_links ADD COLUMN IF NOT EXISTS "viewOnce" bool DEFAULT false NOT NULL
// query: extracted.statement5
ALTER TABLE IF EXISTS public.message_media_links ADD COLUMN IF NOT EXISTS "deliveryExpiresAt" timestamp(3)
