import { expect, test } from "bun:test";

import {
  analysisStageComplete,
  transcriptionComplete,
  transcriptionRetryEligible,
  mediaEmbeddingComplete,
  classificationFingerprint,
} from "./checkpoints";
import { sampleTimes } from "./video-samples";

test("completed empty OCR and silent transcription survive retries", () => {
  expect(
    analysisStageComplete(
      { analysisStages: { ocr: { status: "completed" } } },
      "ocr"
    )
  ).toBe(true);
  expect(transcriptionComplete({ transcription: { status: "silent" } })).toBe(
    true
  );
  expect(
    transcriptionComplete({
      analysisStages: { transcription: { status: "no_audio" } },
    })
  ).toBe(true);
  expect(
    transcriptionComplete({
      analysisStages: { transcription: { status: "skipped" } },
    })
  ).toBe(true);
  expect(transcriptionComplete({ transcription: { status: "skipped" } })).toBe(
    true
  );
  expect(transcriptionComplete({ transcription: { status: "failed" } })).toBe(
    false
  );
  expect(transcriptionComplete(null)).toBe(false);
});

test("skipped transcription is terminal and not retry-eligible", () => {
  expect(
    transcriptionRetryEligible({
      analysisStages: { transcription: { status: "skipped" } },
    })
  ).toBe(false);
  expect(
    transcriptionRetryEligible({
      transcription: { status: "skipped" },
    })
  ).toBe(false);
});

test("video sampling covers the clip and bounds short or invalid durations", () => {
  expect(sampleTimes(100)).toEqual([10, 40, 70, 90]);
  expect(sampleTimes(0)).toEqual([0]);
  expect(sampleTimes(Number.NaN)).toEqual([0]);
  expect(sampleTimes(0.01)).toEqual([0]);
});

test("multimodal checkpoints require the current extraction fingerprint and model", () => {
  const metadata = {
    analysisStages: {
      mediaEmbedding: {
        fingerprint: classificationFingerprint("old", "speech"),
        model: "gemini:v2",
        status: "completed",
      },
    },
  };
  expect(mediaEmbeddingComplete(metadata, "gemini:v2", "old", "speech")).toBe(
    true
  );
  expect(mediaEmbeddingComplete(metadata, "gemini:v2", "new", "speech")).toBe(
    false
  );
  expect(mediaEmbeddingComplete(metadata, "gemini:v3", "old", "speech")).toBe(
    false
  );
  expect(mediaEmbeddingComplete(null, "gemini:v2", null, null)).toBe(false);
});

test("scene timestamps stay inside bounded windows and similar frames are deduplicated", async () => {
  const { sceneTimestamp, similarFrame } = await import("./video-samples");
  expect(sceneTimestamp("pts_time:1.5", 10, 4)).toBe(11.5);
  expect(sceneTimestamp("pts_time:40", 10, 4)).toBe(10);
  expect(sceneTimestamp("no cut", 10, 4)).toBe(10);
  expect(
    similarFrame(new Uint8Array([100, 100]), new Uint8Array([101, 99]))
  ).toBe(true);
  expect(
    similarFrame(new Uint8Array([100, 100]), new Uint8Array([200, 200]))
  ).toBe(false);
});
