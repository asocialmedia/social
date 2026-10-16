import { expect, mock, test } from "bun:test";

const recorded: string[][] = [];
let tags = ["humor"];
let text = "";
mock.module("@asm/db", () => ({
  recordSharedTopicRelations: (values: string[]) => {
    recorded.push(values);
    return Promise.resolve();
  },
  redis: {},
}));
mock.module("../env", () => ({ workerEnv: { CLASSIFY_ENABLED: true } }));
mock.module("../log", () => ({
  mediaLogger: { info: () => {}, warn: () => {} },
  withSpan: (_name: string, run: () => Promise<unknown>) => run(),
}));
mock.module("./clef", () => ({
  clefSafetyVerdict: () => ({ explicit: false }),
  evaluateClef: (input: { text: string }) => {
    ({ text } = input);
    return Promise.resolve({ tags });
  },
}));
const { classifyMediaConcepts } = await import("./classify");

test("OCR captions inform the model without adding arbitrary n-grams to the graph", async () => {
  const result = await classifyMediaConcepts({
    mediaId: "m1",
    ocrText: "SORRY BRO YOUR MEME IS STILL UNDER CONSTRUCTION",
    transcript: "I just can't believe you were lying. #watermark",
  });
  expect(result.tags).toEqual(["humor"]);
  expect(recorded).toEqual([["humor"]]);
  expect(text).toContain("UNDER CONSTRUCTION");
  expect(text).toContain("lying");
});

test("an empty model decision stays empty instead of inventing transcript entities", async () => {
  tags = [];
  const result = await classifyMediaConcepts({
    mediaId: "m2",
    transcript: "just want this okay",
  });
  expect(result.tags).toEqual([]);
  expect(recorded).toHaveLength(1);
});
