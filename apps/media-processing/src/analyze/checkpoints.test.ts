import { expect, test } from "bun:test";

import { analysisStageComplete, transcriptionComplete } from "./checkpoints";
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
  expect(transcriptionComplete({ transcription: { status: "failed" } })).toBe(
    false
  );
  expect(transcriptionComplete(null)).toBe(false);
});
test("video sampling covers the clip and bounds short or invalid durations", () => {
  expect(sampleTimes(100)).toEqual([10, 40, 70, 90]);
  expect(sampleTimes(0)).toEqual([0]);
  expect(sampleTimes(Number.NaN)).toEqual([0]);
  expect(sampleTimes(0.01)).toEqual([0]);
});
