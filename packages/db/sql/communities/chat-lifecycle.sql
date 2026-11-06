// query: extracted.statement1
SELECT "messageId", emoji, count(*)::integer AS count, bool_or("userId" = $2) AS reacted
       FROM public.community_chat_reactions WHERE "messageId" = ANY($1::text[])
       GROUP BY "messageId", emoji ORDER BY count DESC, emoji ASC
// query: extracted.statement2
SELECT id FROM public.post_media WHERE id=$1 FOR UPDATE
// query: extracted.statement3
SELECT count(DISTINCT emoji)::integer AS count FROM public.community_chat_reactions WHERE "messageId" = $1
