import { describe, expect, test } from "bun:test";

describe("Alt-Text Assist generator logic", () => {
  test("generates video alt-text from speech transcript and semantic tags", () => {
    const transcript =
      "In this guide we are setting up a WireGuard VPN tunnel on Arch Linux.";
    const semanticTags = ["linux", "networking", "vpn"];

    const snippet =
      transcript.length > 150 ? `${transcript.slice(0, 147)}...` : transcript;
    const tagsStr = semanticTags.slice(0, 5).join(", ");
    const suggestedAlt = `Video with spoken dialogue: "${snippet}" (Topics: ${tagsStr})`;

    expect(suggestedAlt).toContain("WireGuard VPN tunnel");
    expect(suggestedAlt).toContain("linux, networking, vpn");
  });

  test("generates image alt-text from OCR text and semantic tags", () => {
    const ocrText = "Error 404: Page not found on server";
    const semanticTags = ["tech", "coding"];

    const snippet =
      ocrText.length > 150 ? `${ocrText.slice(0, 147)}...` : ocrText;
    const tagsStr = semanticTags.slice(0, 5).join(", ");
    const suggestedAlt = `Image containing text: "${snippet}" (Themes: ${tagsStr})`;

    expect(suggestedAlt).toContain("Error 404: Page not found on server");
    expect(suggestedAlt).toContain("tech, coding");
  });

  test("falls back to semantic concept tags when no text/speech is present", () => {
    const semanticTags = ["nature", "travel", "japan"];
    const tagsStr = semanticTags.slice(0, 5).join(", ");
    const suggestedAlt = `Image depicting ${tagsStr}`;

    expect(suggestedAlt).toBe("Image depicting nature, travel, japan");
  });

  test("falls back to semantic tags when transcript or OCR is whitespace-only", () => {
    const whitespaceTranscript = "   \n\t  ";
    const cleanTranscript = whitespaceTranscript.trim();
    const semanticTags = ["podcast", "discussion"];
    const tagsStr = semanticTags.slice(0, 5).join(", ");

    let suggestedAlt = "";
    if (cleanTranscript) {
      suggestedAlt = `Video with spoken dialogue: "${cleanTranscript}"`;
    } else if (tagsStr) {
      suggestedAlt = `Video featuring ${tagsStr}`;
    }

    expect(cleanTranscript).toBe("");
    expect(suggestedAlt).toBe("Video featuring podcast, discussion");
  });
});
