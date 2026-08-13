// src/pipeline/ffmpegExtract.ts

import { spawn } from "child_process";
import path from "path";
import { promises as fs } from "fs";
import { ThumbnailFrame } from "./types";

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

export async function probeHasAudio(videoPath: string): Promise<boolean> {
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

export async function extractAudio(
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

// Extracts 1fps thumbnails used only for candidate detection (never sent to Claude)
export async function extractThumbnails(
  videoPath: string,
  outDir: string,
  fps = 1,
): Promise<ThumbnailFrame[]> {
  const thumbDir = path.join(outDir, "thumbs");
  await fs.mkdir(thumbDir, { recursive: true });
  await runFfmpeg([
    "-i",
    videoPath,
    "-vf",
    `fps=${fps},scale=320:-1`,
    path.join(thumbDir, "frame-%06d.png"),
  ]);

  const files = (await fs.readdir(thumbDir))
    .filter((f) => f.endsWith(".png"))
    .sort();
  return files.map((f, i) => ({
    index: i,
    timestampSec: i / fps,
    path: path.join(thumbDir, f),
  }));
}

/** Extracts frames at higher fps within a narrow time window (Stage 4 only). */
export async function extractWindowFrames(
  videoPath: string,
  outDir: string,
  windowStartSec: number,
  windowEndSec: number,
  fps = 8,
): Promise<string[]> {
  const dir = path.join(
    outDir,
    "windows",
    `${windowStartSec.toFixed(2)}-${windowEndSec.toFixed(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  const duration = Math.max(windowEndSec - windowStartSec, 0.2);

  await runFfmpeg([
    "-ss",
    windowStartSec.toFixed(3),
    "-i",
    videoPath,
    "-t",
    duration.toFixed(3),
    "-vf",
    `fps=${fps}`,
    "-q:v",
    "2",
    path.join(dir, "f-%04d.png"),
  ]);

  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".png"))
    .sort();
  return files.map((f) => path.join(dir, f));
}
