import { expect, test } from "bun:test";

import { transcriptionRetryEligible } from "../analyze/checkpoints";
import { missingEnrichmentStages } from "./enrichment";

const enabled = { embedding: true, ocr: true, transcription: true };
test("current classification does not conceal missing enrichment; empty/silent stages remain terminal", () => {
  const media = {
    metadata: { semanticClassificationVersion: "current" },
    ocrText: null,
    parentNeedsEmbedding: true,
    transcript: null,
    type: "VIDEO",
  };
  expect(missingEnrichmentStages(media, enabled)).toEqual([
    "ocr",
    "transcription",
    "embedding",
  ]);
  expect(
    missingEnrichmentStages(
      {
        ...media,
        metadata: {
          analysisStages: {
            ocr: { status: "completed" },
            transcription: { status: "silent" },
          },
        },
        parentNeedsEmbedding: false,
      },
      enabled
    )
  ).toEqual([]);
  expect(
    missingEnrichmentStages(media, {
      embedding: false,
      ocr: false,
      transcription: false,
    })
  ).toEqual([]);
});

test("reconciliation respects failed transcription attempt limits and retry windows", () => {
  const now = Date.now();
  expect(
    transcriptionRetryEligible({ transcription: { attempts: 3 } }, now)
  ).toBe(false);
  expect(
    transcriptionRetryEligible(
      {
        transcription: {
          attemptedAt: new Date(now - 1000).toISOString(),
          attempts: 1,
        },
      },
      now
    )
  ).toBe(false);
  expect(
    transcriptionRetryEligible(
      {
        transcription: {
          attemptedAt: new Date(now - 7 * 3_600_000).toISOString(),
          attempts: 1,
        },
      },
      now
    )
  ).toBe(true);
  expect(transcriptionRetryEligible({ analysisStages: {} }, now)).toBe(true);
});
