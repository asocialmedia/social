import { afterAll, describe, expect, test } from "bun:test";
// Integration tests for the published-original A/V metadata scrub. Real
// ffmpeg encodes tiny fixtures carrying identifying metadata, the scrub
// remuxes them with stream copy, and ffprobe asserts the identifying tags
// are gone while the media streams survive intact.
//
// These run against the same ffmpeg binary the worker uses, so a muxer
// regression (wrong extension, dropped flag) fails loudly here.

import { planAvStrip, stripAvContainerMetadata } from "./av-strip";

const WORK_DIR = `/tmp/asm-av-strip-test-${process.pid}`;
const createdFiles: string[] = [];

afterAll(async () => {
  await Bun.$`rm -rf ${WORK_DIR}`.quiet().catch(() => null);
});

async function run(args: string[]): Promise<void> {
  const proc = Bun.spawn(args, {
    stderr: "pipe",
    stdin: "ignore",
    stdout: "ignore",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${args[0]} failed (${exitCode}): ${stderr.slice(-300)}`);
  }
}

interface ProbeTags {
  formatTags: Record<string, string>;
  streamCount: number;
}

async function probeTags(path: string): Promise<ProbeTags> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "quiet", "-show_format", "-show_streams", path],
    { stderr: "ignore", stdin: "ignore", stdout: "pipe" }
  );
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  const formatTags: Record<string, string> = {};
  let inFormat = false;
  let streamCount = 0;
  for (const line of text.split("\n")) {
    if (line === "[FORMAT]") {
      inFormat = true;
    } else if (line === "[/FORMAT]") {
      inFormat = false;
    } else if (line.startsWith("[STREAM]")) {
      streamCount += 1;
    } else if (inFormat && line.startsWith("TAG:")) {
      const [key, ...rest] = line.slice(4).split("=");
      if (key) {
        formatTags[key.toLowerCase()] = rest.join("=");
      }
    }
  }
  return { formatTags, streamCount };
}

async function encodeFixture(spec: {
  audioCodec: string;
  container: string;
  extension: string;
  withVideo?: boolean;
}): Promise<string> {
  const target = `${WORK_DIR}/fixture-${spec.container}.${spec.extension}`;
  const args =
    spec.withVideo === true
      ? [
          "-f",
          "lavfi",
          "-i",
          "testsrc=duration=1:size=64x64:rate=5",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=1",
          "-map",
          "0:v",
          "-map",
          "1:a",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-c:a",
          "aac",
        ]
      : [
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=1",
          "-c:a",
          spec.audioCodec,
        ];
  await run([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...args,
    "-metadata",
    "title=SECRET-TITLE",
    "-metadata",
    "artist=SECRET-ARTIST",
    "-metadata",
    "comment=SECRET-COMMENT",
    target,
  ]);
  createdFiles.push(target);
  return target;
}

const CASES: {
  audioCodec: string;
  container: string;
  extension: string;
  withVideo?: boolean;
}[] = [
  {
    audioCodec: "aac",
    container: "iso-bmff",
    extension: "mp4",
    withVideo: true,
  },
  { audioCodec: "aac", container: "mov", extension: "mov", withVideo: true },
  { audioCodec: "aac", container: "m4a", extension: "m4a" },
  { audioCodec: "libmp3lame", container: "mpeg-audio", extension: "mp3" },
  { audioCodec: "libopus", container: "ogg", extension: "ogg" },
  { audioCodec: "flac", container: "flac", extension: "flac" },
  { audioCodec: "pcm_s16le", container: "wav", extension: "wav" },
];

describe("planAvStrip", () => {
  test("maps containers to muxer extensions and faststart flags", () => {
    expect(planAvStrip("iso-bmff")).toEqual({
      extension: "mp4",
      faststart: true,
    });
    expect(planAvStrip("mpeg-audio")).toEqual({
      extension: "mp3",
      faststart: false,
    });
    expect(planAvStrip("jpeg")).toBeNull();
  });
});

describe("stripAvContainerMetadata", () => {
  test("every supported container loses identifying metadata and keeps streams", async () => {
    await Bun.$`mkdir -p ${WORK_DIR}`.quiet();
    for (const spec of CASES) {
      const inputPath = await encodeFixture(spec);
      const outputPath = `${WORK_DIR}/stripped-${spec.container}.${spec.extension}`;
      createdFiles.push(outputPath);

      // Sanity: the fixture carries the tags before scrubbing. ffmpeg writes
      // no global metadata into some containers (Ogg comments live in
      // per-stream OpusTags/VorbisComment headers, not -metadata globals), so
      // the canary is conditional: whenever the fixture DID carry a title,
      // the scrubbed output must have dropped it.
      const before = await probeTags(inputPath);
      const fixtureCarriedTags = before.formatTags.title !== undefined;
      if (fixtureCarriedTags) {
        expect(before.formatTags.title).toBe("SECRET-TITLE");
      }

      await stripAvContainerMetadata({
        container: spec.container,
        inputPath,
        outputPath,
        timeoutMs: 30_000,
      });

      const after = await probeTags(outputPath);
      if (fixtureCarriedTags) {
        expect(after.formatTags.title).toBeUndefined();
      }
      expect(after.formatTags.artist).toBeUndefined();
      expect(after.formatTags.comment).toBeUndefined();
      // The media payload must survive the copy.
      expect(after.streamCount).toBeGreaterThan(0);
      // The output is a real, playable file, not a zero-byte stub.
      expect(Bun.file(outputPath).size).toBeGreaterThan(0);
    }
  });

  test("mp4 output is faststarted (moov before mdat)", async () => {
    await Bun.$`mkdir -p ${WORK_DIR}`.quiet();
    const inputPath = await encodeFixture({
      audioCodec: "libx264",
      container: "iso-bmff",
      extension: "mp4",
      withVideo: true,
    });
    const outputPath = `${WORK_DIR}/faststart.mp4`;
    createdFiles.push(outputPath);
    await stripAvContainerMetadata({
      container: "iso-bmff",
      inputPath,
      outputPath,
      timeoutMs: 30_000,
    });
    const head = Buffer.from(
      await Bun.file(outputPath).slice(0, 64).arrayBuffer()
    );
    const moovAt = head.indexOf("moov");
    const mdatAt = head.indexOf("mdat");
    expect(moovAt).toBeGreaterThan(-1);
    if (mdatAt !== -1) {
      expect(moovAt).toBeLessThan(mdatAt);
    }
  });

  test("unknown containers fail closed instead of guessing a muxer", async () => {
    await Bun.$`mkdir -p ${WORK_DIR}`.quiet();
    await expect(
      stripAvContainerMetadata({
        container: "jpeg",
        inputPath: `${WORK_DIR}/whatever`,
        outputPath: `${WORK_DIR}/out`,
        timeoutMs: 1000,
      })
    ).rejects.toThrow("no remux muxer");
  });
});
