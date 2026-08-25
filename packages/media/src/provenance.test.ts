import { describe, expect, test } from "bun:test";

import { detectAiFromManifestStore, isStampableForC2Pa } from "./provenance";

const TRAINED_AI =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
const CAPTURE = "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture";

describe("detectAiFromManifestStore", () => {
  test("empty or absent stores report no C2PA and no AI", () => {
    for (const store of [null, {}, { manifests: {} }]) {
      const verdict = detectAiFromManifestStore(store);
      expect(verdict.aiGenerated).toBe(false);
      expect(verdict.c2paPresent).toBe(false);
      expect(verdict.evidence).toEqual([]);
    }
  });

  test("Firefly-style manifest: digitalSourceType + generator", () => {
    const verdict = detectAiFromManifestStore({
      manifests: {
        "urn:uuid:firefly": {
          assertions: [
            {
              data: {
                actions: [
                  {
                    action: "c2pa.created",
                    digitalSourceType: TRAINED_AI,
                    softwareAgent: "Adobe Firefly",
                  },
                ],
              },
              label: "c2pa.actions",
            },
          ],
          claim_generator: "Adobe Firefly Generative AI 1.3",
        },
      },
    });
    expect(verdict.aiGenerated).toBe(true);
    expect(verdict.c2paPresent).toBe(true);
    expect(verdict.evidence.some((e) => e.kind === "digitalSourceType")).toBe(
      true
    );
    expect(verdict.generators.length).toBeGreaterThan(0);
  });

  test("OpenAI-style manifest: generator info array + AI Generated label", () => {
    const verdict = detectAiFromManifestStore({
      manifests: {
        m1: {
          assertions: [
            {
              data: { "@type": "CreativeWork", name: "AI Generated" },
              label: "stds.schema-org.CustomMetadata",
            },
          ],
          claim_generator_info: [{ name: "DALL-E", version: "3" }],
        },
      },
    });
    expect(verdict.aiGenerated).toBe(true);
    expect(verdict.evidence.some((e) => e.kind === "assertion")).toBe(true);
    expect(verdict.generators.join(",")).toMatch(/[Dd][Aa][Ll][Ll]-[Ee]/);
  });

  test("camera capture with ordinary software is not flagged", () => {
    const verdict = detectAiFromManifestStore({
      manifests: {
        m1: {
          assertions: [
            {
              data: {
                actions: [
                  {
                    action: "c2pa.edited",
                    digitalSourceType: CAPTURE,
                    softwareAgent: "Apple Camera",
                  },
                ],
              },
              label: "c2pa.actions",
            },
          ],
          claim_generator: "Adobe Photoshop 25.1 (Macintosh)",
        },
      },
    });
    expect(verdict.aiGenerated).toBe(false);
    expect(verdict.c2paPresent).toBe(true);
  });

  test("ingredient chains are scanned, not just the active manifest", () => {
    const verdict = detectAiFromManifestStore({
      manifests: {
        active: {
          assertions: [],
          claim_generator: "asm.social media pipeline v1",
        },
        parent: {
          assertions: [],
          claim_generator: "Midjourney Renderer",
        },
      },
    });
    expect(verdict.aiGenerated).toBe(true);
    expect(verdict.generators.some((g) => /midjourney/i.test(g))).toBe(true);
  });

  test("non-learning algorithmic sources still count as synthetic", () => {
    const verdict = detectAiFromManifestStore({
      manifests: {
        m1: {
          assertions: [
            {
              data: {
                actions: [
                  {
                    action: "c2pa.created",
                    digitalSourceType:
                      "http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia",
                  },
                ],
              },
              label: "c2pa.actions",
            },
          ],
        },
      },
    });
    expect(verdict.aiGenerated).toBe(true);
  });

  test("malformed manifests never throw", () => {
    const store = {
      manifests: {
        alsoWeird: { assertions: [null, "string", { label: 5 }] },
        broken: null,
        weird: { assertions: "not-an-array", claim_generator: 42 },
      },
    };
    expect(() => detectAiFromManifestStore(store)).not.toThrow();
    // The generator number and junk entries produce no evidence.
    expect(detectAiFromManifestStore(store).aiGenerated).toBe(false);
  });
});

describe("isStampableForC2Pa", () => {
  test("embedded-manifest formats stamp; others fall back to DB-only flag", () => {
    expect(isStampableForC2Pa("image/jpeg")).toBe(true);
    expect(isStampableForC2Pa("image/png")).toBe(true);
    expect(isStampableForC2Pa("image/webp")).toBe(true);
    expect(isStampableForC2Pa("video/mp4")).toBe(false);
    expect(isStampableForC2Pa("image/gif")).toBe(false);
    expect(isStampableForC2Pa("audio/mpeg")).toBe(false);
  });
});
