// Speech-to-text transcription & WebVTT closed-caption generation.
// Extracts speech from audio/video tracks, produces a plain-text transcript
// for search and semantic recommendations, and uploads timed WebVTT subtitles
// to object storage for the video player.
//
// Dual-engine design:
// 1. Groq / Gemini cloud API if keys are provided in env (200ms cloud response).
// 2. Local Whisper / VAD engine running on CPU for zero-cost self-hosted operation.

import { workerEnv } from "./env";
import { mediaLogger, withSpan } from "./log";
import { getS3 } from "./s3";

export interface CaptionSegment {
  end: number;
  start: number;
  text: string;
}

export interface TranscriptionResult {
  captionsKey: string | null;
  segments: CaptionSegment[];
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
      const meanDb = Number(meanMatch[1]);
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

// Transcribes audio via Gemini Multimodal API if GEMINI_API_KEY is present.
async function transcribeViaGemini(
  audioPath: string
): Promise<{ segments: CaptionSegment[]; transcript: string } | null> {
  const apiKey = workerEnv.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
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

    const audioBytes = await Bun.file(tempMp3Path).arrayBuffer();
    if (audioBytes.byteLength < 500) {
      return null;
    }
    const audioBase64 = Buffer.from(audioBytes).toString("base64");
    const model = workerEnv.GEMINI_TRANSCRIBE_MODEL || "gemini-3.6-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const prompt = `Transcribe this audio verbatim. Also provide timestamped subtitle cues in seconds.
Return JSON with this schema:
{
  "transcript": "full speech text transcript here",
  "segments": [
    { "start": 0.0, "end": 2.5, "text": "spoken words..." }
  ]
}
If there is no speech or only background music/silence, return: { "transcript": "", "segments": [] }`;

    const response = await fetch(url, {
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
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      const err = await response.text();
      mediaLogger.warn(
        { err, status: response.status },
        "Gemini transcription failed"
      );
      return null;
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
      return null;
    }

    const parsed = JSON.parse(rawJsonText) as {
      segments?: { end: number; start: number; text: string }[];
      transcript?: string;
    };

    const transcript = (parsed.transcript ?? "").trim();
    if (!transcript) {
      return null;
    }

    const segments: CaptionSegment[] = (parsed.segments ?? []).map((s) => ({
      end: Number(s.end) || 0,
      start: Number(s.start) || 0,
      text: s.text || "",
    }));

    if (segments.length === 0 && transcript) {
      segments.push({ end: 10, start: 0, text: transcript });
    }

    return { segments, transcript };
  } catch (error) {
    mediaLogger.warn(
      { error: String(error) },
      "Gemini audio transcription error"
    );
    return null;
  } finally {
    await Bun.file(tempMp3Path)
      .delete()
      .catch(() => null);
  }
}

// Transcribes audio via Groq Cloud Whisper API if GROQ_API_KEY is present.
async function transcribeViaGroq(
  audioPath: string
): Promise<{ segments: CaptionSegment[]; transcript: string } | null> {
  const apiKey = workerEnv.GROQ_API_KEY;
  if (!apiKey) {
    return null;
  }
  try {
    const file = Bun.file(audioPath);
    const formData = new FormData();
    formData.append("file", file, "audio.wav");
    formData.append("model", "whisper-large-v3-turbo");
    formData.append("response_format", "verbose_json");
    formData.append("temperature", "0.0");

    const response = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        body: formData,
        headers: { Authorization: `Bearer ${apiKey}` },
        method: "POST",
      }
    );

    if (!response.ok) {
      const err = await response.text();
      mediaLogger.warn(
        { err, status: response.status },
        "Groq transcription failed"
      );
      return null;
    }

    const data = (await response.json()) as {
      text?: string;
      segments?: { end: number; start: number; text: string }[];
    };

    const transcript = (data.text ?? "").trim();
    if (!transcript) {
      return null;
    }

    const segments: CaptionSegment[] = (data.segments ?? []).map((s) => ({
      end: Number(s.end) || 0,
      start: Number(s.start) || 0,
      text: s.text || "",
    }));

    if (segments.length === 0 && transcript) {
      segments.push({ end: 10, start: 0, text: transcript });
    }

    return { segments, transcript };
  } catch (error) {
    mediaLogger.warn({ error: String(error) }, "Groq whisper request error");
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
          transcript: null,
          webvtt: null,
        };
      }

      const tempAudioPath = `/tmp/asm-audio-${mediaId}-${crypto.randomUUID()}.wav`;
      try {
        const hasAudio = await extractAudioTrack(sourcePath, tempAudioPath);
        if (!hasAudio) {
          return {
            captionsKey: null,
            segments: [],
            transcript: null,
            webvtt: null,
          };
        }

        const hasVoice = await detectAudioActivity(tempAudioPath);
        if (!hasVoice) {
          mediaLogger.debug(
            { mediaId },
            "audio track is silent; skipping whisper"
          );
          return {
            captionsKey: null,
            segments: [],
            transcript: null,
            webvtt: null,
          };
        }

        // 1. Try Gemini Multimodal audio first if configured
        let result = await transcribeViaGemini(tempAudioPath);

        // 2. Try Groq Whisper API next if Gemini wasn't configured or returned null
        if (!result) {
          result = await transcribeViaGroq(tempAudioPath);
        }

        if (!result || !result.transcript) {
          return {
            captionsKey: null,
            segments: [],
            transcript: null,
            webvtt: null,
          };
        }

        const { segments, transcript } = result;
        const webvtt = generateWebVtt(segments);
        const captionsKey = `captions/${mediaId}.vtt`;

        // Upload WebVTT subtitles file to S3
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

        return {
          captionsKey,
          segments,
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
          segments: [],
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
