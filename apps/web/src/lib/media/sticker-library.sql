// query: extracted.statement1
SELECT s.id, s.favorite FROM public.user_stickers s JOIN public.post_media p ON p.id=s."mediaId" WHERE s."userId"=$1 AND (s."mediaId"=$2 OR s."mediaId"=$3 OR p."techMetadata"->>'stickerOriginMediaId'=$3) ORDER BY s."createdAt", s.id LIMIT 1
