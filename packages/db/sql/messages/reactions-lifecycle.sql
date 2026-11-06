// query: extracted.statement1
SELECT COALESCE(r."messageId", r."incognitoMessageId") AS "messageId", r.emoji, r.count,
      EXISTS (SELECT 1 FROM public.message_reactions mine
        WHERE mine."userId"=$4 AND mine.emoji=r.emoji
          AND ((r."messageId" IS NOT NULL AND mine."messageId"=r."messageId")
            OR (r."incognitoMessageId" IS NOT NULL AND mine."incognitoMessageId"=r."incognitoMessageId"))) AS "reactedByMe"
    FROM public.message_reaction_counts r
    LEFT JOIN public.messages m ON m.id=r."messageId"
    LEFT JOIN public.message_incognito_messages im ON im.id=r."incognitoMessageId"
    LEFT JOIN public.message_incognito_sessions s ON s.id=im."sessionId"
    WHERE ((r."messageId"=ANY($1::text[]) AND m."conversationId"=$3)
      OR (r."incognitoMessageId"=ANY($2::text[]) AND s."conversationId"=$3))
    ORDER BY r.count DESC, r.emoji ASC
// query: extracted.statement2
SELECT EXISTS (SELECT 1 FROM public.message_conversations c
        JOIN public.message_conversation_members m ON m."conversationId"=c.id
        WHERE c.id=$1 AND m."userId"=$2 AND m."leftAt" IS NULL
        FOR UPDATE OF m) AS allowed
// query: extracted.statement3
SELECT id FROM public.messages WHERE id=$1 AND "conversationId"=$2 AND "deletedAt" IS NULL
          AND ("expiresAt" IS NULL OR "expiresAt">clock_timestamp()) FOR UPDATE
// query: extracted.statement4
SELECT m.id FROM public.message_incognito_messages m
          JOIN public.message_incognito_sessions s ON s.id=m."sessionId"
          WHERE m.id=$1 AND s.id=$2 AND s."conversationId"=$3 AND s."endedAt" IS NULL
            AND m."createdAt">clock_timestamp()-interval '24 hours'
          FOR UPDATE OF m, s
// query: extracted.statement5
SELECT emoji FROM public.message_reactions WHERE "{{fragment1}}"=$1 AND "userId"=$2 FOR UPDATE
// query: extracted.statement6
DELETE FROM public.message_reactions WHERE "{{fragment1}}"=$1 AND "userId"=$2
// query: extracted.statement7
INSERT INTO public.message_reactions (id,"{{fragment1}}","userId",emoji)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT ("{{fragment2}}","userId") DO UPDATE SET emoji=EXCLUDED.emoji
// query: extracted.statement8
DELETE FROM public.message_reaction_counts WHERE "{{fragment1}}"=$1 AND emoji=$2 AND count=1
// query: extracted.statement9
UPDATE public.message_reaction_counts SET count=count-1
      WHERE "{{fragment1}}"=$1 AND emoji=$2 AND count>1
// query: extracted.statement10
INSERT INTO public.message_reaction_counts (id,"{{fragment1}}",emoji,count)
      VALUES ($1,$2,$3,1)
      ON CONFLICT ("{{fragment2}}",emoji) DO UPDATE SET count=public.message_reaction_counts.count+1
