#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  lit,
  rawSql,
} from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/7a502bc4412f0e7c01b3d285e677c4a8b10a96a3e30b1e511292ef236a63e0d5/contract";
import startContract from "../../snapshots/7a502bc4412f0e7c01b3d285e677c4a8b10a96a3e30b1e511292ef236a63e0d5/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/c2ae4bf0006593fd1e630dfdbfb1900a1f9d4ee08e26b8b1a57f6f22b14aa52f/contract";
import endContract from "../../snapshots/c2ae4bf0006593fd1e630dfdbfb1900a1f9d4ee08e26b8b1a57f6f22b14aa52f/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "message_search_terms",
        column: col("documentFrequency", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      rawSql({
        id: "message-search-term-document-frequency-trigger",
        label:
          "Backfill search term document frequencies and maintain them from document changes",
        operationClass: "additive",
        target: {
          id: "postgres",
          details: {
            schema: "public",
            objectType: "dependency",
            name: "message_search_term_document_frequency_trigger",
          },
        },
        precheck: [
          {
            description:
              "ensure the search document frequency trigger is missing",
            sql: `SELECT NOT EXISTS (
              SELECT 1
                FROM pg_catalog.pg_trigger
               WHERE tgname = 'message_search_term_document_frequency_trigger'
                 AND tgrelid = 'public.message_search_documents'::regclass
                 AND NOT tgisinternal
            ) AS result`,
          },
        ],
        execute: [
          {
            description: "backfill normalized term document frequencies",
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
            description:
              "create the search term document frequency trigger function",
            sql: `CREATE OR REPLACE FUNCTION public.update_message_search_term_document_frequency()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
              IF TG_OP = 'INSERT' THEN
                UPDATE public.message_search_terms
                   SET "documentFrequency" = "documentFrequency" + 1
                 WHERE id = ANY(NEW."termIds");
                RETURN NEW;
              END IF;
              IF TG_OP = 'DELETE' THEN
                UPDATE public.message_search_terms
                   SET "documentFrequency" = "documentFrequency" - 1
                 WHERE id = ANY(OLD."termIds");
                RETURN OLD;
              END IF;
              IF OLD."termIds" IS DISTINCT FROM NEW."termIds" THEN
                UPDATE public.message_search_terms
                   SET "documentFrequency" = "documentFrequency" - 1
                 WHERE id = ANY(OLD."termIds")
                   AND NOT (id = ANY(NEW."termIds"));
                UPDATE public.message_search_terms
                   SET "documentFrequency" = "documentFrequency" + 1
                 WHERE id = ANY(NEW."termIds")
                   AND NOT (id = ANY(OLD."termIds"));
              END IF;
              RETURN NEW;
            END;
            $$`,
          },
          {
            description: "create the search term document frequency trigger",
            sql: `CREATE TRIGGER message_search_term_document_frequency_trigger
            AFTER INSERT OR UPDATE OF "termIds" OR DELETE
            ON public.message_search_documents
            FOR EACH ROW
            EXECUTE FUNCTION public.update_message_search_term_document_frequency()`,
          },
        ],
        postcheck: [
          {
            description: "verify search term frequencies and trigger",
            sql: `SELECT EXISTS (
              SELECT 1
                FROM pg_catalog.pg_trigger
               WHERE tgname = 'message_search_term_document_frequency_trigger'
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
