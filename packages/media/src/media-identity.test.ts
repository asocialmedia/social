import { describe, expect, test } from "bun:test";

import {
  mediaIdentityXmp,
  mediaReshareLabel,
  readMediaIdentityXmp,
} from "./media-identity";
import { detectAiFromXmp, detectAiFromManifestStore } from "./provenance";

describe("portable media identity and AI declarations", () => {
  test("keeps opaque identity and positive AI declarations without personal metadata", () => {
    const xmp = mediaIdentityXmp("media_123", true);
    expect(readMediaIdentityXmp(xmp)).toBe("media_123");
    expect(detectAiFromXmp(xmp).aiGenerated).toBe(true);
    expect(detectAiFromXmp(mediaIdentityXmp("media_123")).aiGenerated).toBe(
      false
    );
    expect(xmp).not.toContain("GPS");
    expect(xmp).not.toContain("uploader");
    expect(() => mediaIdentityXmp('bad"<id')).toThrow();
  });
  test("recognizes versioned C2PA actions and structured software agents", () => {
    expect(
      detectAiFromManifestStore({
        manifests: {
          active: {
            assertions: [
              {
                data: {
                  actions: [
                    {
                      action: "c2pa.created",
                      digitalSourceType:
                        "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
                      softwareAgent: { name: "Adobe Firefly" },
                    },
                  ],
                },
                label: "c2pa.actions.v2",
              },
            ],
          },
        },
      }).aiGenerated
    ).toBe(true);
    expect(
      detectAiFromXmp(
        "<Iptc4xmpExt:DigitalSourceType>https://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType>"
      ).aiGenerated
    ).toBe(true);
    expect(
      detectAiFromXmp(
        '<x DigitalSourceType="https://evil.test/trainedAlgorithmicMedia"/>'
      ).aiGenerated
    ).toBe(false);
  });
  test("requires checked public attribution for the below-post label", () => {
    const media = {
      generatedAltText: "originally from @alice reshared via @bob",
      originalProvenanceId: "root",
    };
    expect(mediaReshareLabel(media)).toBeNull();
    expect(mediaReshareLabel({ ...media, attributionPublic: true })).toBe(
      media.generatedAltText
    );
    expect(
      mediaReshareLabel({
        ...media,
        attributionPublic: true,
        originalProvenanceId: null,
      })
    ).toBeNull();
  });
});
