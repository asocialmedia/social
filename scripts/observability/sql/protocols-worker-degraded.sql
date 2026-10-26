SELECT MAX(_timestamp) AS _timestamp, body, operation, code
FROM "asm_protocols_us_east_logs"
WHERE severity = 'WARN'
  AND (code IS NULL OR code NOT IN ('invalid_input', 'restricted', 'cancelled'))
  AND (
    (
      body = 'Protocol upstream request failed'
      AND operation LIKE 'worker.transport.%'
      AND operation <> 'worker.transport.app.bsky.feed.getFeed'
    )
    OR (
      body = 'Protocol request failed'
      AND operation <> 'ingestion.hydrate'
    )
    OR body = 'Protocol read worker unavailable; trying available capacity'
  )
GROUP BY COALESCE(NULLIF(requestid, ''), CAST(_timestamp AS VARCHAR)), body, operation, code
ORDER BY _timestamp DESC
LIMIT 100
