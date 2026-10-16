// query: mediaAnalysis.playback
SELECT "eventType", count(*)::int AS count, COALESCE(avg("durationMs"), 0)::float8 AS "meanMs", COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"), 0)::float8 AS "p95Ms" FROM recommendation_events WHERE "createdAt" > now() - interval '24 hours' AND "eventType" IN ('IMPRESSION','PLAYBACK_STARTUP','BUFFER','PLAYBACK_ERROR','VIEW_COMPLETE') GROUP BY "eventType"

// query: mediaAnalysis.patchMetadata
UPDATE post_media SET "techMetadata" = COALESCE("techMetadata", '{}'::jsonb) || $2::jsonb WHERE id = $1

// query: mediaAnalysis.patchStage
UPDATE post_media SET "techMetadata" = jsonb_set(COALESCE("techMetadata", '{}'::jsonb), '{analysisStages}', COALESCE("techMetadata"->'analysisStages', '{}'::jsonb) || $2::jsonb) WHERE id = $1

// query: mediaAnalysis.coverage
SELECT count(*) FILTER (WHERE "techMetadata"->>'semanticClassificationVersion' IS DISTINCT FROM $1)::int AS pending, count(*)::int AS ready FROM post_media WHERE status = 'READY' AND type IN ('IMAGE','VIDEO','AUDIO')
