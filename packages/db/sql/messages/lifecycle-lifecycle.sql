// query: extracted.statement1
SELECT c.type::text AS type, m.role::text AS role, m."leftAt", u."displayName",
    c."retentionSeconds", c."retentionVersion", c."changeSeq", m."clearedThroughSequence", m."clearedAt"
    FROM public.message_conversations c JOIN public.message_conversation_members m ON m."conversationId"=c.id AND m."userId"=$2
    JOIN public.users u ON u.id=m."userId" WHERE c.id=$1 FOR UPDATE OF c
// query: extracted.statement2
SELECT clock_timestamp() AS now
// query: extracted.statement3
INSERT INTO public.message_incognito_sessions
      (id,"conversationId","startedById","startedByName","startedAt","expiresAt","nextSequence")
      VALUES ($1,$2,$3,$4,statement_timestamp(),NULL,0)
      ON CONFLICT (id) DO NOTHING
// query: extracted.statement4
UPDATE public.message_conversations SET "retentionVersion"="retentionVersion"+1,"updatedAt"=clock_timestamp() WHERE id=$1
// query: extracted.statement5
UPDATE public.message_incognito_sessions SET
      "endedAt"=clock_timestamp(),"endReason"='manual',
      "endedById"=$3,"endedByName"=$4
      WHERE id=$1 AND "conversationId"=$2 AND "endedAt" IS NULL
// query: extracted.statement6
UPDATE public.message_conversations SET "retentionVersion"="retentionVersion"+1 WHERE id=$1
// query: extracted.statement7
UPDATE public.message_conversations SET "retentionSeconds"=$2::integer, "retentionVersion"="retentionVersion"+1 WHERE id=$1
// query: extracted.statement8
SELECT id FROM public.message_incognito_sessions WHERE "conversationId"=$1 AND "endedAt" IS NULL LIMIT 1
// query: extracted.statement9
UPDATE public.message_conversation_members SET "clearedThroughSequence"=$3::integer,"clearedAt"=clock_timestamp(),
      "inboxHiddenAt"=CASE WHEN $4::integer>$3::integer THEN NULL ELSE clock_timestamp() END,
      "lastReadSequence"=GREATEST(COALESCE("lastReadSequence",0),$3::integer),"lastReadAt"=clock_timestamp(),"unreadCount"=NULL
      WHERE "conversationId"=$1 AND "userId"=$2
// query: extracted.statement10
UPDATE public.message_export_jobs SET status='revoked' WHERE "conversationId"=$1 AND "userId"=$2 AND status IN ('pending','processing','ready')
// query: extracted.statement11
SELECT id FROM public.message_incognito_sessions WHERE "conversationId"=$1 AND "endedAt" IS NULL LIMIT 1
// query: extracted.statement12
SELECT clock_timestamp() AS now
// query: extracted.statement13
SELECT EXISTS(SELECT 1 FROM public.message_incognito_sessions WHERE id=$1 AND "conversationId"=$2 AND "endedAt" IS NULL) AS active
// query: extracted.statement14
INSERT INTO public.message_incognito_messages (id,"sessionId","senderId",ciphertext,iv,"keyEpoch","ratchetIndex",sequence,"createdAt")
      SELECT $1,$2,$3,$4,$5,$6::integer,$7::integer,$7::integer,clock_timestamp()
      FROM public.message_incognito_sessions WHERE id=$2 AND "endedAt" IS NULL
// query: extracted.statement15
UPDATE public.message_incognito_sessions SET "nextSequence"="nextSequence"+1 WHERE id=$1
// query: extracted.statement16
SELECT jsonb_build_object('id',m.id,'sessionId',m."sessionId",'senderId',m."senderId",'ciphertext',m.ciphertext,'iv',m.iv,
      'keyEpoch',m."keyEpoch",'ratchetIndex',m."ratchetIndex",'sequence',m.sequence,'createdAt',to_char(m."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS data
    FROM public.message_incognito_messages m JOIN public.message_incognito_sessions s ON s.id=m."sessionId"
    WHERE s.id=$1 AND s."conversationId"=$2 AND s."endedAt" IS NULL AND m."createdAt">clock_timestamp()-interval '24 hours'
    AND m."createdAt">clock_timestamp()-interval '24 hours'
    AND ($3::integer IS NULL OR m.sequence<$3::integer) ORDER BY m.sequence DESC LIMIT 51
// query: extracted.statement17
SELECT "userId" FROM public.message_conversation_members
      WHERE "conversationId"=$1 AND "leftAt" IS NULL AND "userId"<>$2 ORDER BY "userId"
// query: extracted.statement18
SELECT LEAST($1::timestamp + interval '24 hours',
        COALESCE($2::timestamp,$1::timestamp + interval '24 hours')) AS "deliveryExpiresAt",
        LEAST($1::timestamp + interval '24 hours',
          COALESCE($2::timestamp,$1::timestamp + interval '24 hours'))>clock_timestamp() AS live
// query: extracted.statement19
SELECT r.id AS "recipientId",COALESCE(p."publishedKey",NULLIF(p.key,'')) AS "objectKey",
        p."detectedMime" AS "mimeType",p.size,COALESCE(m.id,i.id) AS "messageId",s.id AS "sessionId",
        (p."messageViewOnce" AND p."status"='READY' AND p.type='IMAGE' AND l."deliveryExpiresAt">clock_timestamp()
          AND ((m.id IS NOT NULL AND m."conversationId"=$1 AND m."deletedAt" IS NULL
            AND (m."expiresAt" IS NULL OR m."expiresAt">clock_timestamp()))
            OR (i.id IS NOT NULL AND s."conversationId"=$1 AND s."endedAt" IS NULL
              AND i."createdAt">clock_timestamp()-interval '24 hours'))) AS live,
        l."deliveryExpiresAt"
        FROM public.message_media_links l
        JOIN public.post_media p ON p.id=l."mediaId"
        JOIN public.message_view_once_recipients r ON r."mediaLinkId"=l.id AND r."userId"=$3
        LEFT JOIN public.messages m ON m.id=l."messageId"
        LEFT JOIN public.message_incognito_messages i ON i.id=l."incognitoMessageId"
        LEFT JOIN public.message_incognito_sessions s ON s.id=i."sessionId"
        WHERE l."mediaId"=$2 AND l."viewOnce"=true AND p."messageConversationId"=$1
        FOR UPDATE OF l,r,p
// query: extracted.statement20
SELECT g.status::text AS status,(g.status='RESERVED' AND g."expiresAt">clock_timestamp()) AS available
        FROM public.message_view_once_grants g JOIN public.message_view_once_recipients r ON r.id=g."recipientId"
        WHERE g.id=$1 AND r.id=$2 FOR UPDATE OF g
// query: extracted.statement21
DELETE FROM public.message_view_once_grants
        WHERE "recipientId"=$1 AND status='RESERVED' AND "expiresAt"<=clock_timestamp()
// query: extracted.statement22
SELECT EXISTS(SELECT 1 FROM public.message_view_once_grants WHERE "recipientId"=$1
          AND (status IN ('CLOSED','EXPIRED','REVOKED') OR status='ACTIVE' AND "expiresAt"<=clock_timestamp())) AS consumed,
          EXISTS(SELECT 1 FROM public.message_view_once_grants WHERE "recipientId"=$1
          AND status IN ('RESERVED','ACTIVE') AND "expiresAt">clock_timestamp()) AS opening
// query: extracted.statement23
INSERT INTO public.message_view_once_grants (id,"recipientId",status,"reservedAt","expiresAt")
        VALUES ($1,$2,'RESERVED',clock_timestamp(),clock_timestamp()+interval '2 minutes')
// query: extracted.statement24
SELECT COALESCE(l."messageId",l."incognitoMessageId") AS "messageId",i."sessionId"
        FROM public.message_view_once_grants g
        JOIN public.message_view_once_recipients r ON r.id=g."recipientId" AND r."userId"=$2
        JOIN public.message_media_links l ON l.id=r."mediaLinkId"
        LEFT JOIN public.message_incognito_messages i ON i.id=l."incognitoMessageId"
        WHERE g.id=$1
// query: extracted.statement25
UPDATE public.message_view_once_grants g SET status='ACTIVE',"activatedAt"=clock_timestamp(),
        "expiresAt"=clock_timestamp()+interval '2 minutes'
      FROM public.message_view_once_recipients r,public.message_media_links l,public.post_media p
      WHERE g.id=$1 AND g."recipientId"=r.id AND r."userId"=$2 AND l.id=r."mediaLinkId"
        AND p.id=l."mediaId" AND l."viewOnce"=true AND l."deliveryExpiresAt">clock_timestamp()
        AND p."messageViewOnce"=true AND p."status"='READY' AND p."messageConversationId"=$3
        AND g.status='RESERVED' AND g."expiresAt">clock_timestamp()
        AND ((l."messageId" IS NOT NULL AND EXISTS(SELECT 1 FROM public.messages m
            WHERE m.id=l."messageId" AND m."deletedAt" IS NULL
            AND (m."expiresAt" IS NULL OR m."expiresAt">clock_timestamp())))
          OR (l."incognitoMessageId" IS NOT NULL AND EXISTS(SELECT 1 FROM public.message_incognito_messages i
            JOIN public.message_incognito_sessions s ON s.id=i."sessionId"
            WHERE i.id=l."incognitoMessageId" AND i."createdAt">clock_timestamp()-interval '24 hours'
            AND s."conversationId"=$3 AND s."endedAt" IS NULL)))
// query: extracted.statement26
INSERT INTO public.message_view_once_receipts (id,"mediaId","userId","messageId","incognitoMessageId","openedAt")
        SELECT g.id,l."mediaId",r."userId",l."messageId",l."incognitoMessageId",g."activatedAt"
        FROM public.message_view_once_grants g JOIN public.message_view_once_recipients r ON r.id=g."recipientId"
        JOIN public.message_media_links l ON l.id=r."mediaLinkId" WHERE g.id=$1
        ON CONFLICT ("mediaId","userId") DO NOTHING
// query: extracted.statement27
DELETE FROM public.message_view_once_grants g USING public.message_view_once_recipients r
    WHERE g.id=$1 AND g."recipientId"=r.id AND r."userId"=$2 AND g.status='RESERVED'
// query: extracted.statement28
UPDATE public.message_view_once_grants g SET status='CLOSED',"closedAt"=clock_timestamp(),"expiresAt"=date_trunc('milliseconds',clock_timestamp())
    FROM public.message_view_once_recipients r WHERE g.id=$1 AND g."recipientId"=r.id
      AND r."userId"=$2 AND g.status='ACTIVE'
// query: extracted.statement29
SELECT COUNT(*)::integer AS count FROM public.message_media_links WHERE "mediaId"=$1
// query: extracted.statement30
SELECT EXISTS (SELECT 1 FROM public.message_incognito_sessions s
          JOIN public.message_conversation_members v ON v."conversationId"=s."conversationId" AND v."userId"=$2 AND v."leftAt" IS NULL
          WHERE s.id=$1 AND s."endedAt" IS NULL) AS allowed
// query: extracted.statement31
SELECT EXISTS (SELECT 1 FROM public.message_conversation_members v
        WHERE v."conversationId"=$1 AND v."userId"=$2 AND v."leftAt" IS NULL) AS allowed
// query: extracted.statement32
SELECT EXISTS (
    SELECT 1 FROM public.message_media_links l JOIN public.messages m ON m.id=l."messageId"
    JOIN public.message_conversation_members v ON v."conversationId"=m."conversationId" AND v."userId"=$2
    JOIN public.post_media p ON p.id=l."mediaId"
    WHERE l."mediaId"=$1 AND p."incognitoSessionId" IS NULL AND m."deletedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt">clock_timestamp())
    AND ((m."creationSequence">v."clearedThroughSequence") OR (m."creationSequence"=0 AND (v."clearedAt" IS NULL OR m."createdAt">v."clearedAt")))
    AND EXISTS (SELECT 1 FROM jsonb_array_elements($3::jsonb) w
      WHERE (w->>'after' IS NULL OR m."createdAt">=(w->>'after')::timestamp)
      AND (w->>'before' IS NULL OR m."createdAt"<=(w->>'before')::timestamp))
    AND ($4::boolean OR EXISTS (SELECT 1 FROM public.message_conversation_keys k
      WHERE k."conversationId"=m."conversationId" AND k."ownerUserId"=$2 AND k.version=m."keyEpoch"))
    AND (NOT EXISTS(SELECT 1 FROM public.message_search_account_state a WHERE a."userId"=$2 AND a."recoveryGeneration">0)
      OR m."keyEpoch" IN ({{fragment1}}))
    AND NOT EXISTS (SELECT 1 FROM public.message_hidden h WHERE h."messageId"=m.id AND h."userId"=$2)
    UNION ALL SELECT 1 FROM public.message_media_links l JOIN public.message_incognito_messages m ON m.id=l."incognitoMessageId"
    JOIN public.message_incognito_sessions s ON s.id=m."sessionId"
    JOIN public.message_conversation_members v ON v."conversationId"=s."conversationId" AND v."userId"=$2 AND v."leftAt" IS NULL
    JOIN public.post_media p ON p.id=l."mediaId"
    WHERE l."mediaId"=$1 AND p."incognitoSessionId"=s.id
    AND s."endedAt" IS NULL AND m."createdAt">clock_timestamp()-interval '24 hours'
    AND (NOT EXISTS(SELECT 1 FROM public.message_search_account_state a WHERE a."userId"=$2 AND a."recoveryGeneration">0)
      OR m."keyEpoch" IN ({{fragment2}}))
    ) AS allowed
