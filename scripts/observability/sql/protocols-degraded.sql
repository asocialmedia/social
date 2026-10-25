SELECT _timestamp, body, operation, code
FROM "asm_protocols_logs"
WHERE severity = 'WARN'
  AND (
    (
      body = 'Protocol request failed'
      AND operation <> 'ingestion.hydrate'
      AND (code IS NULL OR code NOT IN ('invalid_input', 'restricted', 'cancelled'))
    )
    OR body = 'Protocol read worker unavailable; trying available capacity'
    OR (
      body = 'Discovery inventory warmup failed'
      AND (code IS NULL OR code NOT IN ('unavailable', 'rate_limited', 'capacity', 'timeout'))
    )
  )
ORDER BY _timestamp DESC
LIMIT 100
