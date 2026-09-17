-- Community role model: joining grants PARTICIPANT (no badge); the owner
-- promotes participants to MEMBER and members to MODERATOR. PARTICIPANT is
-- appended to the enum so the existing ordinal order (OWNER, MODERATOR,
-- MEMBER) is preserved for `orderBy: { role: "asc" }` and participants sort
-- last.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CommunityRole' AND e.enumlabel = 'PARTICIPANT'
  ) THEN
    ALTER TYPE "CommunityRole" ADD VALUE 'PARTICIPANT';
  END IF;
END $$;

-- New memberships default to PARTICIPANT. Existing rows are left alone: a row
-- that already reads MEMBER was granted under the old model and stays a member
-- rather than being silently demoted.
ALTER TABLE "community_members"
  ALTER COLUMN "role" SET DEFAULT 'PARTICIPANT';