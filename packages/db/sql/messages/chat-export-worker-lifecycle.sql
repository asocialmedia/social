// query: extracted.statement1
UPDATE public.message_export_jobs SET "leaseUntil"=clock_timestamp()+interval '5 minutes',"expiresAt"=LEAST("expiresAt",$2::timestamp) WHERE id=$1 AND status='processing' AND "artifactKey"=$3
