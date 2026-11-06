// query: extracted.statement1
UPDATE public.message_media_links SET "deliveryExpiresAt"=clock_timestamp()
          WHERE "messageId"=$1 AND "viewOnce"=true
