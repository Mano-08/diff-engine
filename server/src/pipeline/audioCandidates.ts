// src/pipeline/audioCandidates.ts

import { promises as fs } from "fs";
import { spawn } from "child_process";
import OpenAI from "openai";
import { AudioCandidate, TranscriptSegment } from "./types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function transcribeAudio(
  wavPath: string,
): Promise<TranscriptSegment[]> {
  const fileBuffer = await fs.readFile(wavPath);
  const file = new File([fileBuffer], "audio.wav", { type: "audio/wav" });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const segments = (transcription as any).segments ?? [];
  return segments.map((s: any) => ({
    startSec: s.start,
    endSec: s.end,
    text: s.text.trim(),
  }));
}

const CANDIDATE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "audio_candidates",
    schema: {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              startSec: { type: "number" },
              endSec: { type: "number" },
              reason: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["startSec", "endSec", "reason", "confidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["candidates"],
      additionalProperties: false,
    },
    strict: true,
  },
} as const;

// find moments in the transcript that describe a distinct, documentable UI action
export async function extractAudioCandidates(
  segments: TranscriptSegment[],
): Promise<AudioCandidate[]> {
  if (segments.length === 0) return [];

  const transcriptText = segments
    .map((s) => `[${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}] ${s.text}`)
    .join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: CANDIDATE_SCHEMA as any,
    messages: [
      {
        role: "system",
        content:
          "You read narrated screen-recording transcripts and identify moments " +
          "that describe a distinct, documentable UI action (clicking a button, " +
          "opening a menu, typing into a field, navigating to a new screen). " +
          "Ignore filler and narration that doesn't describe an action. " +
          "Return timestamps in seconds matching the transcript's own timestamps.",
      },
      { role: "user", content: transcriptText },
    ],
  });

  const raw = response.choices[0].message.content ?? "{}";
  const parsed = JSON.parse(raw) as { candidates: any[] };

  return parsed.candidates.map((c) => ({
    startSec: c.startSec,
    endSec: c.endSec,
    reason: c.reason,
    confidence: c.confidence,
    source: "audio" as const,
  }));
}

export function parseSilenceIntervals(
  ffmpegStderr: string,
): Array<{ startSec: number; endSec: number }> {
  const starts = [...ffmpegStderr.matchAll(/silence_start:\s*([\d.]+)/g)].map(
    (m) => parseFloat(m[1]),
  );
  const ends = [...ffmpegStderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) =>
    parseFloat(m[1]),
  );
  const intervals: Array<{ startSec: number; endSec: number }> = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    intervals.push({ startSec: starts[i], endSec: ends[i] });
  }
  return intervals;
}

/** Secondary cue: pauses in narration often bracket an action. */
export async function detectSilences(
  wavPath: string,
): Promise<Array<{ startSec: number; endSec: number }>> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i",
      wavPath,
      "-af",
      "silencedetect=noise=-30dB:d=0.5",
      "-f",
      "null",
      "-",
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", () => resolve(parseSilenceIntervals(stderr)));
  });
}
