// Speech-to-text transcription & WebVTT closed-caption generation.
// Extracts speech from audio/video tracks, produces a plain-text transcript
// for search and semantic recommendations, and uploads timed WebVTT subtitles
// to object storage for the video player.
//
// Dual-mode pipeline:
// 1. Google Gemini Flash Lite Multimodal API for speech-to-text and timed WebVTT cues.
// 2. Local FFmpeg Voice Activity & volume analysis running on CPU to reject silence.

import { workerEnv } from "./env";
import { mediaLogger, withSpan } from "./log";
import { getS3 } from "./s3";

export interface CaptionSegment {
  end: number;
  start: number;
  text: string;
}

export type TranscriptionStatus =
  | "completed"
  | "no_audio"
  | "silent"
  | "failed"
  | "skipped";

export interface TranscriptionResult {
  captionsKey: string | null;
  error?: string;
  segments: CaptionSegment[];
  status: TranscriptionStatus;
  transcript: string | null;
  webvtt: string | null;
}

// Formats a float second count into standard WebVTT timestamp format:
// HH:MM:SS.mmm
export function formatVttTimestamp(seconds: number): string {
  const safeSec = Math.max(0, seconds);
  const hours = Math.floor(safeSec / 3600);
  const minutes = Math.floor((safeSec % 3600) / 60);
  const secs = Math.floor(safeSec % 60);
  const millis = Math.floor((safeSec % 1) * 1000);

  const hh = hours.toString().padStart(2, "0");
  const mm = minutes.toString().padStart(2, "0");
  const ss = secs.toString().padStart(2, "0");
  const mmm = millis.toString().padStart(3, "0");

  return `${hh}:${mm}:${ss}.${mmm}`;
}

// Generates a valid WebVTT string from timestamped caption segments.
export function generateWebVtt(segments: CaptionSegment[]): string {
  const header = "WEBVTT - AsocialMedia Video Captions\n\n";
  const cues = segments
    .filter((s) => s.text && s.text.trim().length > 0)
    .map((s, index) => {
      const start = formatVttTimestamp(s.start);
      const end = formatVttTimestamp(Math.max(s.end, s.start + 0.5));
      const cleanText = s.text.trim().replaceAll(/\r?\n/g, " ");
      return `${index + 1}\n${start} --> ${end}\n${cleanText}\n`;
    })
    .join("\n");

  return `${header}${cues}`;
}

export function splitTranscriptToCues(
  transcript: string,
  durationSec: number | null
): CaptionSegment[] {
  const text = transcript.trim();
  if (!text) {
    return [];
  }

  const rawChunks = text
    .split(/(?<=[.?!])\s+|\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const lines: string[] = [];
  for (const chunk of rawChunks) {
    const words = chunk.split(/\s+/).filter(Boolean);
    if (words.length <= 8) {
      lines.push(words.join(" "));
    } else {
      for (let i = 0; i < words.length; i += 7) {
        lines.push(words.slice(i, i + 7).join(" "));
      }
    }
  }

  if (lines.length === 0) {
    const words = text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += 7) {
      lines.push(words.slice(i, i + 7).join(" "));
    }
  }

  const totalWords = lines.reduce(
    (acc, l) => acc + l.split(/\s+/).filter(Boolean).length,
    0
  );
  const defaultDuration = Math.max(3, totalWords * 0.38);
  const duration =
    durationSec && durationSec > 0 ? durationSec : defaultDuration;

  let currentStart = 0;
  return lines.map((lineText) => {
    const lineWords = lineText.split(/\s+/).filter(Boolean).length;
    const lineDuration = Math.max(
      1,
      (lineWords / Math.max(1, totalWords)) * duration
    );
    const start = currentStart;
    const end = Math.min(duration, start + lineDuration);
    currentStart = end;
    return {
      end: Number(end.toFixed(3)),
      start: Number(start.toFixed(3)),
      text: lineText,
    };
  });
}

// Extracts a 16kHz mono WAV audio track from any video or audio file using FFmpeg.
// Returns null if the source contains no audio stream.
export async function extractAudioTrack(
  sourcePath: string,
  outputPath: string
): Promise<boolean> {
  try {
    const proc = Bun.spawn(
      [
        "ffmpeg",
        "-y",
        "-i",
        sourcePath,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        outputPath,
      ],
      { stderr: "pipe", stdout: "pipe" }
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return false;
    }
    const file = Bun.file(outputPath);
    const { size } = file;
    // An empty WAV header is 44 bytes; genuine audio will be larger
    return size > 1000;
  } catch (error) {
    mediaLogger.warn({ error: String(error) }, "ffmpeg audio extract failed");
    return false;
  }
}

// Voice Activity Detection / Volume check.
// Returns false if the audio track is silent or near-silence (< -55dB).
export async function detectAudioActivity(audioPath: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(
      [
        "ffmpeg",
        "-i",
        audioPath,
        "-af",
        "volumedetect",
        "-vn",
        "-sn",
        "-dn",
        "-f",
        "null",
        "/dev/null",
      ],
      { stderr: "pipe", stdout: "pipe" }
    );
    const stderrText = await new Response(proc.stderr).text();
    await proc.exited;

    const meanMatch = /mean_volume:\s*(?<mean>-?[\d.]+)\s*dB/i.exec(stderrText);
    if (meanMatch && meanMatch.groups?.mean) {
      const meanDb = Number(meanMatch.groups.mean);
      if (Number.isFinite(meanDb) && meanDb < -55) {
        // Nearly total silence
        return false;
      }
    }
    return true;
  } catch {
    // If detection fails, proceed to attempt transcription
    return true;
  }
}

interface GeminiTranscriptionOutput {
  error?: string;
  segments: CaptionSegment[];
  status: TranscriptionStatus;
  transcript: string;
}

// Transcribes audio via Gemini Multimodal API if GEMINI_API_KEY is present.
async function transcribeViaGemini(
  audioPath: string
): Promise<GeminiTranscriptionOutput> {
  const apiKey = workerEnv.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      error: "missing GEMINI_API_KEY",
      segments: [],
      status: "skipped",
      transcript: "",
    };
  }
  const tempMp3Path = `${audioPath}-gemini.mp3`;
  try {
    // Transcode to compact 32kbps mono MP3 for fast upload to Gemini
    const proc = Bun.spawn(
      [
        "ffmpeg",
        "-y",
        "-i",
        audioPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "32k",
        tempMp3Path,
      ],
      { stderr: "pipe", stdout: "pipe" }
    );
    await proc.exited;

    const audioFile = Bun.file(tempMp3Path);
    const audioBytes = await audioFile.arrayBuffer();
    if (audioBytes.byteLength < 500) {
      return {
        segments: [],
        status: "no_audio",
        transcript: "",
      };
    }
    // The inline (base64) generateContent path has a hard request ceiling;
    // audio past it must not be sent (the API would reject the whole call).
    // No Files API upload path exists in this worker yet, so oversized audio
    // is skipped with a logged reason instead of attempting a doomed request.
    if (audioBytes.byteLength > workerEnv.MAX_TRANSCRIBE_AUDIO_BYTES) {
      mediaLogger.warn(
        {
          bytes: audioBytes.byteLength,
          limit: workerEnv.MAX_TRANSCRIBE_AUDIO_BYTES,
        },
        "audio exceeds inline transcription limit; skipping transcription"
      );
      return {
        error: "audio exceeds inline transcription limit",
        segments: [],
        status: "skipped",
        transcript: "",
      };
    }
    const audioBase64 = Buffer.from(audioBytes).toString("base64");
    const audioDurationSeconds = await probeAudioDuration(audioPath);
    const model =
      workerEnv.GEMINI_TRANSCRIBE_MODEL || "gemini-flash-lite-latest";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // Telling the model the media length bounds its cue timestamps; without
    // it a response missing per-segment timings would otherwise fall back to
    // a guessed 10s cue on a potentially hour-long recording.
    const durationHint =
      audioDurationSeconds === null
        ? ""
        : ` The audio is ${audioDurationSeconds.toFixed(1)} seconds long: every cue must end at or before that.`;
    const prompt = `Transcribe this audio verbatim. Also provide timestamped line-by-line subtitle cues in seconds (each cue should be short, around 3 to 7 words, so it fits comfortably on screen as a subtitle line).${durationHint}
Return JSON with this schema:
{
  "transcript": "full speech text transcript here",
  "segments": [
    { "start": 0.0, "end": 2.5, "text": "short spoken phrase" }
  ]
}
If there is no speech or only background music/silence, return: { "transcript": "", "segments": [] }`;

    const maxRetries = 3;
    let response: Response | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        const delay = Math.min(15_000, 3000 * 2 ** (attempt - 1));
        mediaLogger.warn(
          { attempt, delay, status: 429 },
          "Gemini rate limited; waiting before retry"
        );
        await Bun.sleep(delay);
      }

      response = await fetch(url, {
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    data: audioBase64,
                    mimeType: "audio/mp3",
                  },
                },
                { text: prompt },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json" },
        }),
        headers: {
          "Content-Type": "application/json",
          // Header auth keeps the API key out of access logs and error URLs.
          "x-goog-api-key": apiKey,
        },
        method: "POST",
        // Bounded request so a stalled Gemini call cannot pin the analyze
        // worker; the surrounding catch treats an abort like any other
        // failure and returns null.
        signal: AbortSignal.timeout(workerEnv.TRANSCRIBE_TIMEOUT_MS),
      });

      if (response.status !== 429) {
        break;
      }
    }

    if (!response || !response.ok) {
      const err = response ? await response.text() : "no response";
      mediaLogger.warn(
        { err, status: response?.status },
        "Gemini transcription failed"
      );
      return {
        error: `HTTP ${response?.status ?? "unknown"}: ${err.slice(0, 200)}`,
        segments: [],
        status: "failed",
        transcript: "",
      };
    }

    const data = (await response.json()) as {
      candidates?: {
        content?: {
          parts?: { text?: string }[];
        };
      }[];
    };

    const rawJsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJsonText) {
      return {
        segments: [],
        status: "completed",
        transcript: "",
      };
    }

    const parsed = JSON.parse(rawJsonText) as {
      segments?: { end: number; start: number; text: string }[];
      transcript?: string;
    };

    const transcript = (parsed.transcript ?? "").trim();
    if (!transcript) {
      return {
        segments: [],
        status: "completed",
        transcript: "",
      };
    }

    const rawSegments: CaptionSegment[] = (parsed.segments ?? []).map((s) => ({
      end: Number(s.end) || 0,
      start: Number(s.start) || 0,
      text: s.text || "",
    }));

    let segments: CaptionSegment[] = [];
    if (rawSegments.length === 0) {
      segments = splitTranscriptToCues(transcript, audioDurationSeconds);
    } else {
      for (const seg of rawSegments) {
        const segText = seg.text.trim();
        if (!segText) {
          continue;
        }
        const words = segText.split(/\s+/).filter(Boolean);
        if (words.length <= 8) {
          segments.push(seg);
        } else {
          // Break oversized cues down into line-by-line subtitle cues
          const subDuration = Math.max(0.5, seg.end - seg.start);
          let curStart = seg.start;
          for (let i = 0; i < words.length; i += 7) {
            const chunkWords = words.slice(i, i + 7);
            const chunkText = chunkWords.join(" ");
            const chunkDur = (chunkWords.length / words.length) * subDuration;
            const end = Math.min(seg.end, curStart + chunkDur);
            segments.push({
              end: Number(end.toFixed(3)),
              start: Number(curStart.toFixed(3)),
              text: chunkText,
            });
            curStart = end;
          }
        }
      }
    }

    if (segments.length === 0) {
      segments = splitTranscriptToCues(transcript, audioDurationSeconds);
    }

    return { segments, status: "completed", transcript };
  } catch (error) {
    mediaLogger.warn(
      { error: String(error) },
      "Gemini audio transcription error"
    );
    return {
      error: String(error),
      segments: [],
      status: "failed",
      transcript: "",
    };
  } finally {
    await Bun.file(tempMp3Path)
      .delete()
      .catch(() => null);
  }
}

// Probes media duration in seconds via ffprobe; null when unavailable.
async function probeAudioDuration(mediaPath: string): Promise<number | null> {
  try {
    const proc = Bun.spawn(
      [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        mediaPath,
      ],
      { stderr: "pipe", stdout: "pipe" }
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

// Primary transcription runner with self-healing fallback and S3 WebVTT publishing.
export function transcribeMediaAudio(
  sourcePath: string,
  mediaId: string
): Promise<TranscriptionResult> {
  return withSpan(
    "job.media-transcribe",
    async () => {
      if (!workerEnv.WHISPER_ENABLED) {
        return {
          captionsKey: null,
          segments: [],
          status: "skipped",
          transcript: null,
          webvtt: null,
        };
      }

      const tempAudioPath = `/tmp/asm-audio-${mediaId}-${crypto.randomUUID()}.wav`;
      try {
        // 1. Local CPU check: Extract audio track via FFmpeg
        const hasAudio = await extractAudioTrack(sourcePath, tempAudioPath);
        if (!hasAudio) {
          return {
            captionsKey: null,
            segments: [],
            status: "no_audio",
            transcript: null,
            webvtt: null,
          };
        }

        // 2. Local CPU check: Voice Activity & Silence detection
        const hasVoice = await detectAudioActivity(tempAudioPath);
        if (!hasVoice) {
          mediaLogger.debug(
            { mediaId },
            "audio track is silent; skipping transcription"
          );
          return {
            captionsKey: null,
            segments: [],
            status: "silent",
            transcript: null,
            webvtt: null,
          };
        }

        // 3. Transcribe speech using Gemini Flash Lite API
        const result = await transcribeViaGemini(tempAudioPath);

        if (result.status === "failed") {
          return {
            captionsKey: null,
            error: result.error,
            segments: [],
            status: "failed",
            transcript: null,
            webvtt: null,
          };
        }

        if (result.status === "skipped" || result.status === "no_audio") {
          return {
            captionsKey: null,
            error: result.error,
            segments: [],
            status: result.status,
            transcript: null,
            webvtt: null,
          };
        }

        if (!result.transcript) {
          return {
            captionsKey: null,
            segments: [],
            status: "completed",
            transcript: null,
            webvtt: null,
          };
        }

        const { transcript } = result;
        let { segments } = result;
        if (segments.length === 0) {
          segments = splitTranscriptToCues(transcript, null);
        }
        const webvtt = generateWebVtt(segments);
        const captionsKey = `captions/${mediaId}.vtt`;

        // Upload WebVTT subtitles file to S3
        if (webvtt.includes("-->")) {
          try {
            await getS3().file(captionsKey).write(webvtt, {
              type: "text/vtt; charset=utf-8",
            });
            mediaLogger.info(
              { captionsKey, chars: transcript.length, mediaId },
              "transcription & captions generated"
            );
          } catch (uploadError) {
            mediaLogger.error(
              { error: String(uploadError), mediaId },
              "failed to upload captions to S3"
            );
          }
        }

        return {
          captionsKey: webvtt.includes("-->") ? captionsKey : null,
          segments,
          status: "completed",
          transcript,
          webvtt,
        };
      } catch (error) {
        mediaLogger.error(
          { error: String(error), mediaId },
          "transcription error"
        );
        return {
          captionsKey: null,
          error: String(error),
          segments: [],
          status: "failed",
          transcript: null,
          webvtt: null,
        };
      } finally {
        await Bun.$`rm -f ${tempAudioPath}`.quiet().catch(() => null);
      }
    },
    { "media.id": mediaId }
  );
}
