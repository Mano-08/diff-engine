// src/services/audioProcessor.ts

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { nanoid } from "nanoid";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TMP_DIR = path.join(process.cwd(), "tmp");

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface AudioDerivedResult {
  timestamps: number[];
  transcript: TranscriptSegment[];
}

// ── ffmpeg helpers ──

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", ...args]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function runFfprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(`ffprobe exited with ${code}: ${stderr.slice(-2000)}`),
        );
    });
  });
}

async function probeHasAudio(videoPath: string): Promise<boolean> {
  const out = await runFfprobe([
    "-v",
    "error",
    "-select_streams",
    "a",
    "-show_entries",
    "stream=index",
    "-of",
    "csv=p=0",
    videoPath,
  ]);
  return out.trim().length > 0;
}

async function extractAudioTrack(
  videoPath: string,
  outDir: string,
): Promise<string> {
  const outPath = path.join(outDir, "audio.wav");
  await runFfmpeg([
    "-i",
    videoPath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    outPath,
  ]);
  return outPath;
}

async function transcribeAudio(wavPath: string): Promise<TranscriptSegment[]> {
  const fileBuffer = await fs.promises.readFile(wavPath);
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
              timestampSec: { type: "number" },
              reason: { type: "string" },
            },
            required: ["timestampSec", "reason"],
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

async function extractAudioCandidateTimestamps(
  segments: TranscriptSegment[],
): Promise<number[]> {
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
          "You read narrated screen-recording transcripts and identify the moment " +
          "a distinct, documentable UI action happens (clicking a button, opening a menu, " +
          "typing into a field, navigating to a new screen). Ignore filler and narration " +
          "that doesn't describe an action. Return the single best timestamp (in seconds, " +
          "matching the transcript's own timestamps) for each action.",
      },
      { role: "user", content: transcriptText },
    ],
  });

  const raw = response.choices[0].message.content ?? "{}";
  const parsed = JSON.parse(raw) as {
    candidates: Array<{ timestampSec: number }>;
  };

  return parsed.candidates.map((c) => c.timestampSec).sort((a, b) => a - b);
}

/**
 * Extracts audio (if present), transcribes it, and derives candidate
 * timestamps worth turning into documentation steps. Returns an empty
 * result (never throws for "no audio") so callers can fall back to
 * visual-only detection.
 */
export async function getAudioDerivedTimestamps(
  videoPath: string,
): Promise<AudioDerivedResult> {
  const hasAudio = await probeHasAudio(videoPath);
  if (!hasAudio) {
    return { timestamps: [], transcript: [] };
  }

  const jobDir = path.join(TMP_DIR, nanoid());
  await fs.promises.mkdir(jobDir, { recursive: true });

  try {
    const wavPath = await extractAudioTrack(videoPath, jobDir);
    const transcript = await transcribeAudio(wavPath);
    const timestamps = await extractAudioCandidateTimestamps(transcript);
    return { timestamps, transcript };
  } finally {
    // temp wav is never needed again — delete immediately
    await fs.promises
      .rm(jobDir, { recursive: true, force: true })
      .catch(() => {});
  }
}
