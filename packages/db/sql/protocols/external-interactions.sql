// query: interaction.lockTimeout
SET LOCAL lock_timeout = '2000ms'
// query: interaction.statementTimeout
SET LOCAL statement_timeout = '5000ms'
// query: interaction.lockPost
SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
