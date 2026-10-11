// query: development.schemaReady
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
);
// query: development.extensions
SELECT extname FROM pg_extension ORDER BY extname;
