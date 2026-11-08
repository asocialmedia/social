// query: extracted.statement1
DELETE FROM public.message_view_once_receipts WHERE "{{fragment1}}"=ANY($1::text[])
// query: extracted.statement2
UPDATE public.post_media p SET {{fragment1}}
    WHERE p.id IN (SELECT "mediaId" FROM public.message_media_links WHERE "{{fragment2}}"=ANY($1::text[]))
    AND p."messageLifecycleProtected" AND p."postId" IS NULL AND p."commentId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.message_media_links l
      LEFT JOIN public.messages m ON m.id=l."messageId"
      LEFT JOIN public.message_incognito_messages i ON i.id=l."incognitoMessageId"
      LEFT JOIN public.message_incognito_sessions s ON s.id=i."sessionId"
      WHERE l."mediaId"=p.id AND ((m.id IS NOT NULL AND m."deletedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt">clock_timestamp()))
        OR (i.id IS NOT NULL AND s."endedAt" IS NULL AND i."createdAt">clock_timestamp()-interval '24 hours')))
// query: extracted.statement3
DELETE FROM public.message_media_links WHERE "{{fragment1}}"=ANY($1::text[])
// query: extracted.statement4
UPDATE public.post_media p SET {{fragment1}}
    WHERE p.id IN (SELECT staged.id FROM public.post_media staged WHERE staged."incognitoSessionId"=$1 AND staged.status<>'DELETED'
      ORDER BY staged.id LIMIT 100 FOR UPDATE SKIP LOCKED) AND p."incognitoSessionId"=$1 AND p."postId" IS NULL AND p."commentId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.message_media_links l WHERE l."mediaId"=p.id)
// query: extracted.statement5
SELECT c.id,c."changeSeq" FROM public.message_conversations c
      WHERE c.id IN (SELECT m."conversationId" FROM public.messages m WHERE m.ciphertext<>'' AND m."expiresAt"<=clock_timestamp() ORDER BY m."expiresAt",m.id LIMIT 100)
      ORDER BY c.id LIMIT 1 FOR UPDATE OF c SKIP LOCKED
// query: extracted.statement6
WITH due AS (SELECT id FROM public.messages
      WHERE "conversationId"=$1 AND ciphertext<>'' AND "expiresAt"<=clock_timestamp() ORDER BY "expiresAt",id LIMIT 100 FOR UPDATE SKIP LOCKED)
      UPDATE public.messages m SET "deletedAt"=COALESCE("deletedAt",clock_timestamp()),ciphertext='',iv='',revision=revision+1 FROM due WHERE m.id=due.id RETURNING m.id,m.revision
// query: extracted.statement7
UPDATE public.message_conversations SET "changeSeq"=$2::integer WHERE id=$1
// query: extracted.statement8
UPDATE public.message_conversation_members SET "unreadCount"=NULL WHERE "conversationId"=$1
// query: extracted.statement9
UPDATE public.message_export_jobs SET status='revoked' WHERE "conversationId"=$1 AND status IN ('pending','processing','ready')
// query: extracted.statement10
SELECT id, ("endedAt" IS NOT NULL) AS ended FROM public.message_incognito_sessions
      WHERE ("endedAt" IS NOT NULL AND "purgedAt" IS NULL)
      OR id IN (SELECT "sessionId" FROM public.message_incognito_messages WHERE "createdAt"<=clock_timestamp()-interval '24 hours' ORDER BY "createdAt",id LIMIT 100)
      ORDER BY "endedAt",id LIMIT 1 FOR UPDATE SKIP LOCKED
// query: extracted.statement11
SELECT id FROM public.message_incognito_messages
      WHERE "sessionId"=$1 AND ($2::boolean OR "createdAt"<=clock_timestamp()-interval '24 hours') ORDER BY sequence LIMIT 100 FOR UPDATE SKIP LOCKED
// query: extracted.statement12
DELETE FROM public.message_incognito_messages WHERE id=ANY($1::text[])
// query: extracted.statement13
UPDATE public.message_incognito_sessions SET "purgedAt"=clock_timestamp() WHERE id=$1 AND "endedAt" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.message_incognito_messages WHERE "sessionId"=$1)
      AND NOT EXISTS (SELECT 1 FROM public.post_media WHERE "incognitoSessionId"=$1 AND status<>'DELETED')
// query: extracted.statement14
WITH due AS (SELECT id FROM public.message_view_once_grants
      WHERE status='RESERVED' AND "expiresAt"<=clock_timestamp()
      ORDER BY "expiresAt",id LIMIT 100 FOR UPDATE SKIP LOCKED)
    DELETE FROM public.message_view_once_grants g USING due WHERE g.id=due.id
// query: extracted.statement15
WITH due AS (SELECT id FROM public.message_view_once_grants
      WHERE status='ACTIVE' AND "expiresAt"<=clock_timestamp()
      ORDER BY "expiresAt",id LIMIT 100 FOR UPDATE SKIP LOCKED)
    UPDATE public.message_view_once_grants g SET status='EXPIRED' FROM due WHERE g.id=due.id
// query: extracted.statement16
SELECT g.id,r."mediaLinkId" FROM public.message_view_once_grants g
      JOIN public.message_view_once_recipients r ON r.id=g."recipientId"
      WHERE g.status IN ('CLOSED','EXPIRED','REVOKED') AND g."expiresAt"<=clock_timestamp()
      ORDER BY g."expiresAt",g.id LIMIT 100
// query: extracted.statement17
UPDATE public.message_media_links l SET "deliveryExpiresAt"=LEAST(l."deliveryExpiresAt",date_trunc('milliseconds',clock_timestamp()))
        WHERE l.id=ANY($1::text[]) AND l."viewOnce"=true
        AND NOT EXISTS (SELECT 1 FROM public.message_view_once_recipients r WHERE r."mediaLinkId"=l.id
          AND NOT EXISTS (SELECT 1 FROM public.message_view_once_grants g
            WHERE g."recipientId"=r.id AND g.status IN ('CLOSED','EXPIRED','REVOKED')))
// query: extracted.statement18
UPDATE public.message_view_once_grants SET "expiresAt"=NULL
        WHERE id=ANY($1::text[]) AND status IN ('CLOSED','EXPIRED','REVOKED')
// query: extracted.statement19
SELECT l.id,l."mediaId" FROM public.message_media_links l
      WHERE l."viewOnce"=true AND l."deliveryExpiresAt"<=clock_timestamp()
      ORDER BY l."deliveryExpiresAt",l.id LIMIT 100 FOR UPDATE OF l SKIP LOCKED
// query: extracted.statement20
UPDATE public.post_media p SET {{fragment1}}
      WHERE p.id=ANY($1::text[]) AND p."messageViewOnce"=true AND p.status<>'DELETED'
// query: extracted.statement21
DELETE FROM public.message_media_links WHERE id=ANY($1::text[])
