// query: retrieval.topics
SELECT id FROM posts WHERE "semanticTags" && $1::text[] AND "isGust" = $2 ORDER BY "createdAt" DESC LIMIT 150

// query: retrieval.collaborative
WITH own AS (SELECT DISTINCT "postId" FROM recommendation_events WHERE "userId" = $1 AND "eventType" IN ('BOOKMARK','VOTE','VIEW_COMPLETE','SHARE') ORDER BY "postId" LIMIT 100), peers AS (SELECT e."userId", count(DISTINCT e."postId") AS affinity FROM recommendation_events e JOIN own ON own."postId" = e."postId" WHERE e."userId" <> $1 AND e."eventType" IN ('BOOKMARK','VOTE','VIEW_COMPLETE','SHARE') AND e."createdAt" > now() - interval '30 days' GROUP BY e."userId" ORDER BY affinity DESC LIMIT 50) SELECT e."postId" AS id FROM recommendation_events e JOIN peers ON peers."userId" = e."userId" WHERE e."eventType" IN ('BOOKMARK','VOTE','VIEW_COMPLETE','SHARE') AND e."createdAt" > now() - interval '30 days' GROUP BY e."postId" ORDER BY sum(peers.affinity) DESC LIMIT 100
