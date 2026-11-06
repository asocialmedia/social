// query: extracted.statement1
SELECT EXISTS(SELECT 1 FROM public.message_conversation_changes
    WHERE "conversationId"=$1 AND sequence>$2::integer AND kind<>'message.created'
    AND (cardinality("audienceUserIds")=0 OR $3=ANY("audienceUserIds"))) AS changed
// query: extracted.statement2
UPDATE public.message_export_jobs SET status='revoked' WHERE id=$1
// query: extracted.statement3
WITH candidate AS (SELECT id FROM public.message_export_jobs
    WHERE ($2::text IS NULL OR id=$2) AND (status='pending' OR (status='processing' AND "leaseUntil"<clock_timestamp())) AND "expiresAt">clock_timestamp()
    ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
    UPDATE public.message_export_jobs j SET status='processing',"leaseUntil"=clock_timestamp()+interval '5 minutes',"artifactKey"=$1
    FROM candidate c WHERE j.id=c.id RETURNING j.id
