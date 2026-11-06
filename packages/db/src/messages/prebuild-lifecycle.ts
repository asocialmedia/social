import { Client } from "pg";

import { keys } from "../../keys";

export async function prebuildChatLifecycleIndex(): Promise<void> {
  const client = new Client({ connectionString: keys.DATABASE_URL });
  await client.connect();
  try {
    await client.query("SET lock_timeout='5s'");
    await client.query(
      'ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS "expiresAt" timestamp(3)'
    );
    const tables = await client.query<{
      exports: boolean;
      sessions: boolean;
      incognitoMessages: boolean;
    }>(
      `SELECT to_regclass('public.message_export_jobs') IS NOT NULL AS exports, to_regclass('public.message_incognito_sessions') IS NOT NULL AS sessions, to_regclass('public.message_incognito_messages') IS NOT NULL AS "incognitoMessages"`
    );
    const [existing] = tables.rows;
    if (existing?.exports) {
      await client.query(
        'ALTER TABLE public.message_export_jobs ADD COLUMN IF NOT EXISTS "artifactKey" text'
      );
      await client.query(
        'ALTER TABLE public.message_export_jobs ADD COLUMN IF NOT EXISTS "fromDate" timestamp(3)'
      );
      await client.query(
        'ALTER TABLE public.message_export_jobs ADD COLUMN IF NOT EXISTS "toDate" timestamp(3)'
      );
      await client.query(
        'ALTER TABLE public.message_export_jobs ADD COLUMN IF NOT EXISTS "membershipSequence" integer NOT NULL DEFAULT 0'
      );
    }
    if (existing?.sessions) {
      await client.query(
        'ALTER TABLE public.message_incognito_sessions ADD COLUMN IF NOT EXISTS "purgedAt" timestamp(3)'
      );
      await client.query(
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS incognito_purge_due_618ec377 ON public.message_incognito_sessions ("endedAt",id) WHERE ("endedAt" IS NOT NULL AND "purgedAt" IS NULL)'
      );
    }
    if (existing?.incognitoMessages) {
      await client.query(
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS incognito_message_expiry_due_3855cff1 ON public.message_incognito_messages ("createdAt",id)'
      );
    }
    await client.query(
      'ALTER TABLE public.post_media ADD COLUMN IF NOT EXISTS "incognitoSessionId" text'
    );
    await client.query(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_expiry_due_idx_a83a16eb ON public.messages ("expiresAt",id) WHERE ("expiresAt" IS NOT NULL AND "deletedAt" IS NULL)'
    );
    // Follow-up migration 20261016T1647_chat_lifecycle_followup: exact physical names from `migration plan`.
    // Built here with CONCURRENTLY outside the migration transaction so the migration precheck skips them.
    await client.query(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_lifecycle_erasure_due_7f300049 ON public.messages ("expiresAt",id) WHERE ("expiresAt" IS NOT NULL AND ciphertext <> \'\')'
    );
    await client.query(
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS media_lifecycle_erasure_due_d202ba84 ON public.post_media (id) WHERE (\"failureCode\" = 'CHAT_LIFECYCLE_ERASURE')"
    );
    await client.query(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "post_media_incognitoSessionId_idx_e9d021b8" ON public.post_media ("incognitoSessionId")'
    );
    const names = [
      "messages_expiry_due_idx_a83a16eb",
      "messages_lifecycle_erasure_due_7f300049",
      "media_lifecycle_erasure_due_d202ba84",
      "post_media_incognitoSessionId_idx_e9d021b8",
      ...(existing?.sessions ? ["incognito_purge_due_618ec377"] : []),
      ...(existing?.incognitoMessages
        ? ["incognito_message_expiry_due_3855cff1"]
        : []),
    ];
    const { rows } = await client.query<{ name: string; valid: boolean }>(
      "SELECT c.relname AS name, i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])",
      [names]
    );
    if (rows.length !== names.length) {
      throw new Error("A required chat lifecycle index is missing");
    }
    const invalid = rows.filter((row) => !row.valid).map((row) => row.name);
    if (invalid.length > 0) {
      throw new Error(
        `Chat lifecycle indexes invalid; repair before migrating: ${invalid.join(", ")}`
      );
    }
  } finally {
    await client.end();
  }
}
