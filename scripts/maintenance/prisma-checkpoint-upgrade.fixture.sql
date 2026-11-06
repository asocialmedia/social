// query: fixture.createDatabase
CREATE DATABASE "{{name}}"
// query: fixture.dropDatabase
DROP DATABASE IF EXISTS "{{name}}" WITH (FORCE)
// query: fixture.createExtension
CREATE EXTENSION IF NOT EXISTS "{{extension}}"
// query: fixture.updateMarker
UPDATE prisma_contract.marker SET core_hash=$1 WHERE space=$2
// query: fixture.renameColumn
ALTER TABLE public.users RENAME COLUMN username TO broken_username
// query: fixture.restoreColumn
ALTER TABLE public.users RENAME COLUMN broken_username TO username
