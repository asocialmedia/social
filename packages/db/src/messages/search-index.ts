import { Pool } from "pg";

import { keys } from "../../keys";

const MAX_SEARCH_TERM_INSERT_BATCH = 100;

let searchPool: Pool | undefined;

function getSearchPool(): Pool {
  if (!searchPool) {
    searchPool = new Pool({
      application_name: "asocialmedia-dm-search",
      connectionString: keys.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      max: 4,
    });
  }
  return searchPool;
}

export interface SearchTermArtifact {
  gramKeys: string[];
  normalized: string;
}

export interface SearchDocumentArtifact {
  conversationId: string;
  keyEpoch: number;
  messageId: string;
  outboxId: string;
  revision: number;
  terms: readonly SearchTermArtifact[];
}

export interface SearchMessageWindow {
  after: Date | null;
  before: Date | null;
}

export interface SearchCandidateQuery {
  before?: { createdAt: Date; messageId: string };
  conversationId: string;
  fragments: readonly { grams: readonly string[]; text: string }[];
  limit: number;
  membershipWindows: readonly SearchMessageWindow[];
  snapshotSequence: number;
  userId: string;
}

export interface SearchCandidateRow {
  ciphertext: string;
  createdAt: Date;
  id: string;
  iv: string;
  keyEpoch: number;
  ratchetIndex: number;
  revision: number;
  senderId: string;
}

export interface SearchArtifactCommitResult {
  status: "indexed" | "superseded" | "unreadable";
}

function pgTimestamp(value: Date): string {
  return value.toISOString().replace("T", " ").replace("Z", "");
}

export async function persistSearchDocument(
  artifact: SearchDocumentArtifact
): Promise<SearchArtifactCommitResult> {
  const pool = getSearchPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const source = await client.query<{
      createdAt: Date;
      deletedAt: Date | null;
      revision: number;
    }>(
      `SELECT "createdAt", "deletedAt", revision
         FROM public.messages
        WHERE id = $1 AND "conversationId" = $2
        FOR SHARE`,
      [artifact.messageId, artifact.conversationId]
    );
    const [row] = source.rows;
    let status: SearchArtifactCommitResult["status"] = "superseded";

    if (row && !row.deletedAt && row.revision === artifact.revision) {
      const terms = [
        ...new Map(
          artifact.terms.map((term) => [term.normalized, term])
        ).values(),
      ];
      const termInsertQueries: {
        sql: string;
        values: unknown[];
      }[] = [];
      for (
        let offset = 0;
        offset < terms.length;
        offset += MAX_SEARCH_TERM_INSERT_BATCH
      ) {
        const batch = terms.slice(
          offset,
          offset + MAX_SEARCH_TERM_INSERT_BATCH
        );
        const values: unknown[] = [];
        const tuples = batch.map((term, index) => {
          const base = index * 3;
          values.push(artifact.conversationId, term.normalized, term.gramKeys);
          return `($${base + 1}, $${base + 2}, $${base + 3}::text[])`;
        });
        termInsertQueries.push({
          sql: `INSERT INTO public.message_search_terms
             ("conversationId", normalized, "gramKeys")
           VALUES ${tuples.join(",")}
           ON CONFLICT ("conversationId", normalized) DO NOTHING`,
          values,
        });
      }
      await Promise.all(
        termInsertQueries.map(({ sql, values }) => client.query(sql, values))
      );

      const normalizedTerms = terms.map((term) => term.normalized);
      const termRows = normalizedTerms.length
        ? await client.query<{ id: number }>(
            `SELECT id
               FROM public.message_search_terms
              WHERE "conversationId" = $1 AND normalized = ANY($2::text[])`,
            [artifact.conversationId, normalizedTerms]
          )
        : { rows: [] as { id: number }[] };
      const termIds = [...new Set(termRows.rows.map((term) => term.id))];

      await client.query(
        `INSERT INTO public.message_search_documents
           ("messageId", "conversationId", revision, "createdAt", "termIds")
         VALUES ($1, $2, $3, $4, $5::int[])
         ON CONFLICT ("messageId") DO UPDATE
           SET "conversationId" = EXCLUDED."conversationId",
               revision = EXCLUDED.revision,
               "createdAt" = EXCLUDED."createdAt",
               "termIds" = EXCLUDED."termIds"
         WHERE public.message_search_documents.revision <= EXCLUDED.revision`,
        [
          artifact.messageId,
          artifact.conversationId,
          artifact.revision,
          row.createdAt,
          termIds,
        ]
      );
      await client.query(
        `UPDATE public.messages
            SET "keyEpoch" = $2
          WHERE id = $1 AND revision = $3 AND "keyEpoch" IS NULL`,
        [artifact.messageId, artifact.keyEpoch, artifact.revision]
      );
      status = "indexed";
    } else {
      await client.query(
        `DELETE FROM public.message_search_documents
          WHERE "messageId" = $1 AND revision <= $2`,
        [artifact.messageId, artifact.revision]
      );
    }

    const outbox = await client.query<{
      changeSequence: number;
      conversationId: string;
    }>(
      `UPDATE public.message_search_outbox
          SET "completedAt" = now()
        WHERE id = $1 AND revision = $2 AND "completedAt" IS NULL
        RETURNING "changeSequence", "conversationId"`,
      [artifact.outboxId, artifact.revision]
    );
    const [completed] = outbox.rows;
    if (completed) {
      const coverage = await client.query<{
        maxSequence: number | null;
        pendingSequence: number | null;
      }>(
        `SELECT MAX("changeSequence") AS "maxSequence",
                MIN("changeSequence") FILTER (WHERE "completedAt" IS NULL) AS "pendingSequence"
           FROM public.message_search_outbox
          WHERE "conversationId" = $1`,
        [completed.conversationId]
      );
      const [coverageRow] = coverage.rows;
      const settledSequence =
        coverageRow?.pendingSequence === null ||
        coverageRow?.pendingSequence === undefined
          ? (coverageRow?.maxSequence ?? 0)
          : Math.max(0, coverageRow.pendingSequence - 1);
      await client.query(
        `INSERT INTO public.message_search_coverage
           ("conversationId", "rowsTraversed", "artifactsCommitted", "completedChangeSeq", "updatedAt")
         VALUES ($1, 1, $2, $3, now())
         ON CONFLICT ("conversationId") DO UPDATE
           SET "rowsTraversed" = public.message_search_coverage."rowsTraversed" + 1,
               "artifactsCommitted" = public.message_search_coverage."artifactsCommitted" + $2,
               "completedChangeSeq" = GREATEST(public.message_search_coverage."completedChangeSeq", $3),
               "updatedAt" = now()`,
        [
          completed.conversationId,
          status === "indexed" ? 1 : 0,
          settledSequence,
        ]
      );
    }

    await client.query("COMMIT");
    return { status };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      /* empty */
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function markSearchOutboxUnreadable(input: {
  changeSequence: number;
  conversationId: string;
  outboxId: string;
  revision: number;
}): Promise<void> {
  const pool = getSearchPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const completed = await client.query<{ conversationId: string }>(
      `UPDATE public.message_search_outbox
          SET "completedAt" = now()
        WHERE id = $1 AND revision = $2 AND "completedAt" IS NULL
        RETURNING "conversationId"`,
      [input.outboxId, input.revision]
    );
    if (completed.rows[0]) {
      const coverage = await client.query<{
        maxSequence: number | null;
        pendingSequence: number | null;
      }>(
        `SELECT MAX("changeSequence") AS "maxSequence",
                MIN("changeSequence") FILTER (WHERE "completedAt" IS NULL) AS "pendingSequence"
           FROM public.message_search_outbox
          WHERE "conversationId" = $1`,
        [input.conversationId]
      );
      const [coverageRow] = coverage.rows;
      const settledSequence =
        coverageRow?.pendingSequence === null ||
        coverageRow?.pendingSequence === undefined
          ? (coverageRow?.maxSequence ?? 0)
          : Math.max(0, coverageRow.pendingSequence - 1);
      await client.query(
        `INSERT INTO public.message_search_coverage
           ("conversationId", "rowsTraversed", "unrecoverableEpochs", "completedChangeSeq", "updatedAt")
         VALUES ($1, 1, 1, $2, now())
         ON CONFLICT ("conversationId") DO UPDATE
           SET "rowsTraversed" = public.message_search_coverage."rowsTraversed" + 1,
               "unrecoverableEpochs" = public.message_search_coverage."unrecoverableEpochs" + 1,
               "completedChangeSeq" = GREATEST(public.message_search_coverage."completedChangeSeq", $2),
               "updatedAt" = now()`,
        [input.conversationId, settledSequence]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      /* empty */
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function searchMessageCandidates(
  input: SearchCandidateQuery
): Promise<SearchCandidateRow[]> {
  const windows = input.membershipWindows.map((window) => ({
    after: window.after ? pgTimestamp(window.after) : null,
    before: window.before ? pgTimestamp(window.before) : null,
  }));
  const pool = getSearchPool();
  const result = await pool.query<SearchCandidateRow>(
    `SELECT m.id,
            m."ciphertext",
            m.iv,
            m."ratchetIndex",
            m."senderId",
            m."createdAt",
            m.revision,
            m."keyEpoch"
       FROM public.message_search_documents AS d
       JOIN public.messages AS m
         ON m.id = d."messageId"
        AND m."conversationId" = d."conversationId"
        AND m.revision = d.revision
       JOIN public.message_conversation_members AS member
         ON member."conversationId" = d."conversationId"
        AND member."userId" = $2
      WHERE d."conversationId" = $1
        AND m."deletedAt" IS NULL
        AND m."keyEpoch" IS NOT NULL
        AND m."creationSequence" <= $4
        AND EXISTS (
          SELECT 1
            FROM public.message_conversation_keys AS readable_key
           WHERE readable_key."conversationId" = d."conversationId"
             AND readable_key."ownerUserId" = $2
             AND readable_key.version = m."keyEpoch"
        )
        AND NOT EXISTS (
          SELECT 1
            FROM public.message_hidden AS hidden
           WHERE hidden."messageId" = m.id AND hidden."userId" = $2
        )
        AND NOT EXISTS (
          SELECT 1
            FROM jsonb_array_elements($3::jsonb) AS fragment
           WHERE NOT EXISTS (
             SELECT 1
               FROM public.message_search_terms AS term
              WHERE term."conversationId" = d."conversationId"
                AND d."termIds" @> ARRAY[term.id]
                AND term."gramKeys" @> ARRAY(
                  SELECT jsonb_array_elements_text(fragment.value->'grams')
                )
                AND strpos(term.normalized, fragment.value->>'text') > 0
           )
        )
        AND (
          $7::jsonb IS NULL OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements($7::jsonb) AS window
             WHERE (window.value->>'after' IS NULL OR m."createdAt" >= (window.value->>'after')::timestamp)
               AND (window.value->>'before' IS NULL OR m."createdAt" <= (window.value->>'before')::timestamp)
          )
        )
        AND (
          $5::timestamp IS NULL OR
          (d."createdAt", d."messageId") < ($5::timestamp, $6::text)
        )
      ORDER BY d."createdAt" DESC, d."messageId" DESC
      LIMIT $8`,
    [
      input.conversationId,
      input.userId,
      JSON.stringify(input.fragments),
      input.snapshotSequence,
      input.before ? pgTimestamp(input.before.createdAt) : null,
      input.before?.messageId ?? null,
      JSON.stringify(windows),
      Math.min(Math.max(Math.trunc(input.limit), 1), 21),
    ]
  );
  return result.rows;
}

export async function closeMessageSearchPool(): Promise<void> {
  const pool = searchPool;
  searchPool = undefined;
  if (pool) {
    await pool.end();
  }
}
