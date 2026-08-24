import { describe, expect, test } from "bun:test";

import { detectContent, verifyDeclaredMatchesContent } from "./magic";

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_HEAD = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
const GIF_HEAD = Buffer.from(Buffer.from("GIF89a", "latin1"));
const WEBP_HEAD = Buffer.from(
  Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBP", "latin1")
);
const MP4_HEAD = Buffer.from(
  Buffer.from("\u0000\u0000\u0000\u0018ftypisom\u0000\u0000\u0002\u0000isomiso2", "latin1")
);
const M4A_HEAD = Buffer.from(
  Buffer.from("\u0000\u0000\u0000\u0018ftypM4A \u0000\u0000\u0000\u0000m4a ", "latin1")
);
const MOV_HEAD = Buffer.from(
  Buffer.from("\u0000\u0000\u0000\u0014ftypqt  \u0000\u0000\u0000\u0000qt  ", "latin1")
);
const EBML_WEBM_HEAD = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.alloc(24),
  Buffer.from(Buffer.from("webm", "latin1")),
]);
const OGG_HEAD = Buffer.from(Buffer.from("OggS\u0000\u0002", "latin1"));
const ID3_HEAD = Buffer.from(
  Buffer.from("ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000", "latin1")
);
const WAV_HEAD = Buffer.from(
  Buffer.from("RIFF\u0024\u0000\u0000\u0000WAVEfmt ", "latin1")
);

describe("content detection from bytes", () => {
  test("detects common image formats", () => {
    expect(detectContent(JPEG_HEAD).detected?.mime).toBe("image/jpeg");
    expect(detectContent(PNG_HEAD).detected?.family).toBe("IMAGE");
    expect(detectContent(GIF_HEAD).detected?.container).toBe("gif");
    expect(detectContent(WEBP_HEAD).detected?.container).toBe("webp");
  });

  test("disambiguates iso-bmff brands: mp4 vs m4a vs mov", () => {
    const mp4 = detectContent(MP4_HEAD).detected;
    expect(mp4?.container).toBe("iso-bmff");
    expect(mp4?.family).toBe("VIDEO");

    const m4a = detectContent(M4A_HEAD).detected;
    expect(m4a?.container).toBe("m4a");
    expect(m4a?.family).toBe("AUDIO");

    const mov = detectContent(MOV_HEAD).detected;
    expect(mov?.container).toBe("mov");
    expect(mov?.mime).toBe("video/quicktime");
  });

  test("distinguishes webm from matroska via doctype", () => {
    const webm = detectContent(EBML_WEBM_HEAD).detected;
    expect(webm?.container).toBe("webm");
  });

  test("detects audio containers", () => {
    expect(detectContent(OGG_HEAD).detected?.container).toBe("ogg");
    expect(detectContent(ID3_HEAD).detected?.mime).toBe("audio/mpeg");
    expect(detectContent(WAV_HEAD).detected?.container).toBe("wav");
  });

  test("unknown bytes fail closed", () => {
    const detection = detectContent(Buffer.from("<?php echo 1; ?>"));
    expect(detection.ok).toBe(false);
    expect(detection.detected).toBeUndefined();
  });
});

describe("declared-vs-content verification", () => {
  test("matching families pass and return detection", () => {
    const result = verifyDeclaredMatchesContent(JPEG_HEAD, "image/jpeg");
    expect(result.ok).toBe(true);
    expect(result.detected?.mime).toBe("image/jpeg");
  });

  test("spoofed declarations are rejected with MIME_MISMATCH", () => {
    // Executable/text payload claiming to be a PNG.
    const mismatch = verifyDeclaredMatchesContent(
      Buffer.from("#!/bin/sh\nrm -rf /"),
      "image/png"
    );
    expect(mismatch.ok).toBe(false);
    expect(mismatch.reason).toBe("UNRECOGNIZED_CONTENT");

    // PNG bytes claiming to be video.
    const wrongFamily = verifyDeclaredMatchesContent(PNG_HEAD, "video/mp4");
    expect(wrongFamily.ok).toBe(false);
    expect(wrongFamily.reason).toBe("MIME_MISMATCH");
  });

  test("quicktime alias matches iso-bmff content", () => {
    const result = verifyDeclaredMatchesContent(MOV_HEAD, "video/quicktime");
    expect(result.ok).toBe(true);
  });

  test("matroska alias matches ebml content", () => {
    const result = verifyDeclaredMatchesContent(
      EBML_WEBM_HEAD,
      "video/x-matroska"
    );
    expect(result.ok).toBe(true);
  });

  test("audio declared as audio passes for m4a bytes", () => {
    const result = verifyDeclaredMatchesContent(M4A_HEAD, "audio/mp4");
    expect(result.ok).toBe(true);
  });
});
