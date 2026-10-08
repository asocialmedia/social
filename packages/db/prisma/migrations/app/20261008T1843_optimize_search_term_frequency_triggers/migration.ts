#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  rawSql,
} from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/34b4c4296280a1c84cea452c616e7f02415c28901e44d0e8141fd1c97aec68c9/contract";
import endContract from "../../snapshots/34b4c4296280a1c84cea452c616e7f02415c28901e44d0e8141fd1c97aec68c9/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/c2ae4bf0006593fd1e630dfdbfb1900a1f9d4ee08e26b8b1a57f6f22b14aa52f/contract";
import startContract from "../../snapshots/c2ae4bf0006593fd1e630dfdbfb1900a1f9d4ee08e26b8b1a57f6f22b14aa52f/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.createIndex({
        schema: "public",
        table: "message_search_terms",
        index: "message_search_terms_orphaned_f61e9e26",
        columns: ["conversationId"],
        extras: { where: '("documentFrequency" = 0)' },
      }),
      rawSql({
        id: "replace-row-frequency-trigger-with-set-based-triggers",
        label: "Aggregate search term document frequency changes by statement",
        operationClass: "additive",
        target: {
          id: "postgres",
          details: {
            schema: "public",
            objectType: "dependency",
            name: "message_search_term_document_frequency_triggers",
          },
        },
        precheck: [
          {
            description:
              "ensure the statement-level frequency triggers are incomplete",
            sql: `SELECT NOT (
              NOT EXISTS (
                SELECT 1
                  FROM pg_catalog.pg_trigger
                 WHERE tgname = 'message_search_term_document_frequency_trigger'
                   AND tgrelid = 'public.message_search_documents'::regclass
                   AND NOT tgisinternal
              )
              AND
              (SELECT COUNT(*) FROM pg_catalog.pg_trigger
                WHERE tgname IN (
                  'message_search_terms_frequency_after_insert',
                  'message_search_terms_frequency_after_update',
                  'message_search_terms_frequency_after_delete'
                )
                  AND tgrelid = 'public.message_search_documents'::regclass
                  AND NOT tgisinternal) = 3
            ) AS result`,
          },
        ],
        execute: [
          {
            description: "reconcile normalized term document frequencies",
            sql: `WITH document_frequencies AS (
              SELECT term_id, COUNT(*)::int AS frequency
                FROM public.message_search_documents AS document
                CROSS JOIN LATERAL unnest(document."termIds") AS term_id
               GROUP BY term_id
            )
            UPDATE public.message_search_terms AS term
               SET "documentFrequency" = document_frequencies.frequency
              FROM document_frequencies
             WHERE term.id = document_frequencies.term_id`,
          },
          {
            description: "remove the row-level frequency trigger",
            sql: `DROP TRIGGER IF EXISTS message_search_term_document_frequency_trigger
              ON public.message_search_documents`,
          },
          {
            description:
              "remove a partially installed insert frequency trigger",
            sql: `DROP TRIGGER IF EXISTS message_search_terms_frequency_after_insert
              ON public.message_search_documents`,
          },
          {
            description:
              "remove a partially installed update frequency trigger",
            sql: `DROP TRIGGER IF EXISTS message_search_terms_frequency_after_update
              ON public.message_search_documents`,
          },
          {
            description:
              "remove a partially installed delete frequency trigger",
            sql: `DROP TRIGGER IF EXISTS message_search_terms_frequency_after_delete
              ON public.message_search_documents`,
          },
          {
            description:
              "install the set-based document frequency trigger function",
            sql: `CREATE OR REPLACE FUNCTION public.update_message_search_term_document_frequency()
              RETURNS trigger
              LANGUAGE plpgsql
              AS $$
              BEGIN
                IF TG_OP = 'INSERT' THEN
                  WITH term_deltas AS (
                    SELECT term_id, COUNT(*)::int AS delta
                      FROM (
                        SELECT DISTINCT document."messageId", terms.term_id
                          FROM new_documents AS document
                          CROSS JOIN LATERAL unnest(document."termIds") AS terms(term_id)
                      ) AS unique_terms
                     GROUP BY term_id
                  )
                  UPDATE public.message_search_terms AS term
                     SET "documentFrequency" = term."documentFrequency" + term_deltas.delta
                    FROM term_deltas
                   WHERE term.id = term_deltas.term_id;
                  RETURN NULL;
                END IF;
                IF TG_OP = 'DELETE' THEN
                  WITH term_deltas AS (
                    SELECT term_id, -COUNT(*)::int AS delta
                      FROM (
                        SELECT DISTINCT document."messageId", terms.term_id
                          FROM old_documents AS document
                          CROSS JOIN LATERAL unnest(document."termIds") AS terms(term_id)
                      ) AS unique_terms
                     GROUP BY term_id
                  )
                  UPDATE public.message_search_terms AS term
                     SET "documentFrequency" = term."documentFrequency" + term_deltas.delta
                    FROM term_deltas
                   WHERE term.id = term_deltas.term_id;
                  RETURN NULL;
                END IF;
                WITH old_terms AS (
                  SELECT DISTINCT document."messageId", terms.term_id
                    FROM old_documents AS document
                    CROSS JOIN LATERAL unnest(document."termIds") AS terms(term_id)
                ),
                new_terms AS (
                  SELECT DISTINCT document."messageId", terms.term_id
                    FROM new_documents AS document
                    CROSS JOIN LATERAL unnest(document."termIds") AS terms(term_id)
                ),
                changed_terms AS (
                  SELECT old_term.term_id, -1::int AS delta
                    FROM old_terms AS old_term
                   WHERE NOT EXISTS (
                     SELECT 1 FROM new_terms AS new_term
                      WHERE new_term."messageId" = old_term."messageId"
                        AND new_term.term_id = old_term.term_id
                   )
                  UNION ALL
                  SELECT new_term.term_id, 1::int AS delta
                    FROM new_terms AS new_term
                   WHERE NOT EXISTS (
                     SELECT 1 FROM old_terms AS old_term
                      WHERE old_term."messageId" = new_term."messageId"
                        AND old_term.term_id = new_term.term_id
                   )
                ),
                term_deltas AS (
                  SELECT term_id, SUM(delta)::int AS delta
                    FROM changed_terms
                   GROUP BY term_id
                  HAVING SUM(delta) <> 0
                )
                UPDATE public.message_search_terms AS term
                   SET "documentFrequency" = term."documentFrequency" + term_deltas.delta
                  FROM term_deltas
                 WHERE term.id = term_deltas.term_id;
                RETURN NULL;
              END;
              $$`,
          },
          {
            description: "create the statement-level insert frequency trigger",
            sql: `CREATE TRIGGER message_search_terms_frequency_after_insert
              AFTER INSERT ON public.message_search_documents
              REFERENCING NEW TABLE AS new_documents
              FOR EACH STATEMENT
              EXECUTE FUNCTION public.update_message_search_term_document_frequency()`,
          },
          {
            description: "create the statement-level update frequency trigger",
            sql: `CREATE TRIGGER message_search_terms_frequency_after_update
              AFTER UPDATE ON public.message_search_documents
              REFERENCING OLD TABLE AS old_documents NEW TABLE AS new_documents
              FOR EACH STATEMENT
              EXECUTE FUNCTION public.update_message_search_term_document_frequency()`,
          },
          {
            description: "create the statement-level delete frequency trigger",
            sql: `CREATE TRIGGER message_search_terms_frequency_after_delete
              AFTER DELETE ON public.message_search_documents
              REFERENCING OLD TABLE AS old_documents
              FOR EACH STATEMENT
              EXECUTE FUNCTION public.update_message_search_term_document_frequency()`,
          },
        ],
        postcheck: [
          {
            description:
              "verify statement-level triggers and exact search term frequencies",
            sql: `SELECT NOT EXISTS (
              SELECT 1
                FROM pg_catalog.pg_trigger
               WHERE tgname = 'message_search_term_document_frequency_trigger'
                 AND tgrelid = 'public.message_search_documents'::regclass
                 AND NOT tgisinternal
            ) AND (
              SELECT COUNT(*) = 3
                FROM pg_catalog.pg_trigger
               WHERE tgname IN (
                 'message_search_terms_frequency_after_insert',
                 'message_search_terms_frequency_after_update',
                 'message_search_terms_frequency_after_delete'
               )
                 AND tgrelid = 'public.message_search_documents'::regclass
                 AND NOT tgisinternal
            ) AND NOT EXISTS (
              WITH document_frequencies AS (
                SELECT term_id, COUNT(*)::int AS frequency
                  FROM public.message_search_documents AS document
                  CROSS JOIN LATERAL unnest(document."termIds") AS term_id
                 GROUP BY term_id
              )
              SELECT 1
                FROM public.message_search_terms AS term
                LEFT JOIN document_frequencies
                  ON document_frequencies.term_id = term.id
               WHERE term."documentFrequency" <> COALESCE(document_frequencies.frequency, 0)
            ) AS result`,
          },
        ],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
