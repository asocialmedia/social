// query: extracted.statement1
SELECT COALESCE(m.id,i.id) AS "messageId",i."sessionId",COALESCE(m."senderId",i."senderId") AS "senderId"
    FROM (SELECT "messageId","incognitoMessageId" FROM public.message_media_links WHERE "mediaId"=$2 AND "viewOnce"=true
      UNION SELECT "messageId","incognitoMessageId" FROM public.message_view_once_receipts WHERE "mediaId"=$2) target
    LEFT JOIN public.messages m ON m.id=target."messageId"
    LEFT JOIN public.message_incognito_messages i ON i.id=target."incognitoMessageId"
    LEFT JOIN public.message_incognito_sessions s ON s.id=i."sessionId"
    WHERE m."conversationId"=$1 OR s."conversationId"=$1 LIMIT 1
// query: extracted.statement2
SELECT (SELECT MIN(r."seenAt") FROM public.message_view_once_receipts r
        WHERE r."mediaId"=$1 AND ($3::boolean OR r."userId"=$2)) AS "seenAt",
      ((NOT $3::boolean AND NOT EXISTS (SELECT 1 FROM public.message_view_once_recipients r
        JOIN public.message_media_links l ON l.id=r."mediaLinkId" WHERE l."mediaId"=$1 AND r."userId"=$2))
        OR EXISTS (SELECT 1 FROM public.message_view_once_receipts r WHERE r."mediaId"=$1 AND r."userId"=$2)
        OR NOT EXISTS(SELECT 1 FROM public.message_media_links l JOIN public.post_media p ON p.id=l."mediaId"
          WHERE l."mediaId"=$1 AND l."viewOnce"=true AND l."deliveryExpiresAt">clock_timestamp() AND p.status='READY')) AS unavailable
// query: extracted.statement3
WITH target AS (SELECT id,"seenAt" FROM public.message_view_once_receipts
        WHERE id=$1 AND "mediaId"=$2 AND "userId"=$3
        AND ("seenAt" IS NOT NULL OR "openedAt">clock_timestamp()-interval '5 minutes') FOR UPDATE)
      UPDATE public.message_view_once_receipts r SET "seenAt"=COALESCE(r."seenAt",clock_timestamp()) FROM target
        WHERE r.id=target.id RETURNING r."seenAt",(target."seenAt" IS NULL) AS changed
