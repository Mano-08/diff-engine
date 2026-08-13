// src/pipeline/frameSelection.ts

import sharp from "sharp";
import { extractWindowFrames } from "./ffmpegExtract";
import { MergedCandidate, SelectedScreenshot } from "./types";

const LAPLACIAN_KERNEL = {
  width: 3,
  height: 3,
  kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
};

async function sharpnessScore(framePath: string): Promise<number> {
  const { data, info } = await sharp(framePath)
    .grayscale()
    .convolve(LAPLACIAN_KERNEL)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const n = info.width * info.height;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += data[i];
  mean /= n;

  let variance = 0;
  for (let i = 0; i < n; i++) variance += (data[i] - mean) ** 2;
  variance /= n;

  return variance; // higher = sharper / less motion blur
}

async function frameDiff(a: string, b: string): Promise<number> {
  const [bufA, bufB] = await Promise.all([
    sharp(a).grayscale().resize(160, 90).raw().toBuffer(),
    sharp(b).grayscale().resize(160, 90).raw().toBuffer(),
  ]);
  let sum = 0;
  for (let i = 0; i < bufA.length; i++) sum += Math.abs(bufA[i] - bufB[i]);
  return sum / bufA.length;
}

/**
 * Stage 4: for each merged candidate window, extracts frames at higher fps
 * and keeps only the single sharpest, most-settled frame.
 */
export async function selectBestFrames(
  videoPath: string,
  jobDir: string,
  candidates: MergedCandidate[],
): Promise<SelectedScreenshot[]> {
  const results: SelectedScreenshot[] = [];

  for (const candidate of candidates) {
    const frames = await extractWindowFrames(
      videoPath,
      jobDir,
      candidate.windowStartSec,
      candidate.windowEndSec,
      8,
    );
    if (frames.length === 0) continue;

    const sharpnessScores = await Promise.all(frames.map(sharpnessScore));

    const stabilityScores = await Promise.all(
      frames.map(async (f, i) => {
        const neighbors = [frames[i - 1], frames[i + 1]].filter(
          Boolean,
        ) as string[];
        if (neighbors.length === 0) return 0;
        const diffs = await Promise.all(neighbors.map((n) => frameDiff(f, n)));
        return diffs.reduce((a, b) => a + b, 0) / diffs.length;
      }),
    );

    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < frames.length; i++) {
      const combined = sharpnessScores[i] / 50 - stabilityScores[i];
      if (combined > bestScore) {
        bestScore = combined;
        bestIdx = i;
      }
    }

    results.push({
      candidate,
      framePath: frames[bestIdx],
      sharpness: sharpnessScores[bestIdx],
      stability: stabilityScores[bestIdx],
    });
  }

  return results;
}
