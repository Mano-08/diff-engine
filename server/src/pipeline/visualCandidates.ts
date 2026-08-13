// src/pipeline/visualCandidates.ts

import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { ThumbnailFrame, VisualCandidate } from "./types";

const GRID = 20; // 20x20 blocks per frame

interface GrayFrame {
  data: Buffer;
  width: number;
  height: number;
}

async function loadGray(path: string): Promise<GrayFrame> {
  const { data, info } = await sharp(path)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function cellMeans(frame: GrayFrame, grid = GRID): number[] {
  const { data, width, height } = frame;
  const cellW = Math.floor(width / grid);
  const cellH = Math.floor(height / grid);
  const means: number[] = new Array(grid * grid).fill(0);

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      let sum = 0;
      let count = 0;
      for (let y = gy * cellH; y < (gy + 1) * cellH && y < height; y++) {
        for (let x = gx * cellW; x < (gx + 1) * cellW && x < width; x++) {
          sum += data[y * width + x];
          count++;
        }
      }
      means[gy * grid + gx] = count > 0 ? sum / count : 0;
    }
  }
  return means;
}

/**
 * Stage 2a: profiles which grid cells flicker often but weakly across the
 * whole 1fps thumbnail track (ad banners, looping animations) so later
 * diffs can ignore them. Returns a boolean mask, true = noisy/ignore.
 */
export async function buildNoiseMask(
  thumbnails: ThumbnailFrame[],
): Promise<boolean[]> {
  if (thumbnails.length < 3) return new Array(GRID * GRID).fill(false);

  const allMeans: number[][] = [];
  for (const t of thumbnails) {
    allMeans.push(cellMeans(await loadGray(t.path)));
  }

  const cellCount = GRID * GRID;
  const mask = new Array(cellCount).fill(false);
  const CHANGE_THRESHOLD = 8; // intensity delta counted as "changed"
  const NOISY_FREQ_RATIO = 0.4; // fraction of frames that must change to be "frequent"
  const NOISY_MAG_CAP = 20; // avg magnitude below this = "weak"

  for (let cell = 0; cell < cellCount; cell++) {
    let changes = 0;
    let magSum = 0;
    for (let i = 1; i < allMeans.length; i++) {
      const delta = Math.abs(allMeans[i][cell] - allMeans[i - 1][cell]);
      if (delta > CHANGE_THRESHOLD) changes++;
      magSum += delta;
    }
    const freq = changes / (allMeans.length - 1);
    const avgMag = magSum / (allMeans.length - 1);
    if (freq > NOISY_FREQ_RATIO && avgMag < NOISY_MAG_CAP) {
      mask[cell] = true; // flickers often, weakly -> likely an ad/animation region
    }
  }
  return mask;
}

function maskedDiff(
  meansA: number[],
  meansB: number[],
  mask: boolean[],
): number {
  let sum = 0;
  for (let i = 0; i < meansA.length; i++) {
    if (mask[i]) continue;
    sum += Math.abs(meansA[i] - meansB[i]);
  }
  return sum;
}

/**
 * Stage 2b: finds "burst then settle" points in the masked-diff series.
 * A real UI change spikes once and stays quiet; a looping ad keeps moving.
 */
export async function settlePatternCandidates(
  thumbnails: ThumbnailFrame[],
  mask: boolean[],
): Promise<VisualCandidate[]> {
  const means = await Promise.all(
    thumbnails.map(async (t) => cellMeans(await loadGray(t.path))),
  );
  const diffs: number[] = [];
  for (let i = 1; i < means.length; i++) {
    diffs.push(maskedDiff(means[i - 1], means[i], mask));
  }

  const sorted = [...diffs].sort((a, b) => a - b);
  const burstThreshold = sorted[Math.floor(sorted.length * 0.85)] ?? 0;
  const stableThreshold = sorted[Math.floor(sorted.length * 0.4)] ?? 0;
  const SETTLE_WINDOW = 3; // frames (~3s at 1fps) that must stay quiet after a burst

  const candidates: VisualCandidate[] = [];
  for (let i = 0; i < diffs.length; i++) {
    if (diffs[i] < burstThreshold) continue;
    const following = diffs.slice(i + 1, i + 1 + SETTLE_WINDOW);
    if (following.length < SETTLE_WINDOW) continue;
    const settled = following.every((d) => d < stableThreshold);
    if (!settled) continue;

    candidates.push({
      timestampSec: thumbnails[i + 1].timestampSec,
      reason: "visual burst followed by a stable UI (settle pattern)",
      score: diffs[i] / (burstThreshold || 1),
      source: "visual",
    });
  }
  return candidates;
}

/**
 * Stage 2c: OCR-diff. Only runs on frames already flagged by the settle-pattern
 * gate, to avoid OCR'ing the whole video. Catches label/URL/dialog-title
 * changes that ads don't produce.
 *
 * Note: cursor/click detection is intentionally omitted here - it needs a
 * per-OS/theme cursor icon template and is unreliable across capture tools
 * without one. Wire in a click detector later if you standardize on one
 * recording tool/OS.
 */
export async function ocrDiffCandidates(
  thumbnails: ThumbnailFrame[],
  gateIndices: number[],
): Promise<VisualCandidate[]> {
  if (gateIndices.length === 0) return [];

  const worker = await createWorker("eng");
  const candidates: VisualCandidate[] = [];

  try {
    let prevWords: Set<string> | null = null;
    let prevIndex = -1;

    for (const idx of gateIndices) {
      const { data } = await worker.recognize(thumbnails[idx].path);
      const words = new Set(
        data.text
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2),
      );

      if (prevWords) {
        const union = new Set([...prevWords, ...words]);
        const intersection = [...prevWords].filter((w) => words.has(w));
        const jaccard = union.size > 0 ? intersection.length / union.size : 1;
        const distance = 1 - jaccard;

        if (distance > 0.4 && idx !== prevIndex + 1) {
          candidates.push({
            timestampSec: thumbnails[idx].timestampSec,
            reason: "on-screen text changed significantly (OCR-diff)",
            score: distance,
            source: "visual",
          });
        }
      }
      prevWords = words;
      prevIndex = idx;
    }
  } finally {
    await worker.terminate();
  }

  return candidates;
}

/** Merges settle-pattern + OCR-diff candidates, combining anything within 2s. */
export function fuseVisualCandidates(
  settle: VisualCandidate[],
  ocr: VisualCandidate[],
): VisualCandidate[] {
  const all = [...settle, ...ocr].sort(
    (a, b) => a.timestampSec - b.timestampSec,
  );
  const fused: VisualCandidate[] = [];

  for (const c of all) {
    const last = fused[fused.length - 1];
    if (last && Math.abs(c.timestampSec - last.timestampSec) <= 2) {
      last.score += c.score; // confirmed by both signals -> higher confidence
      last.reason += ` + ${c.reason}`;
    } else {
      fused.push({ ...c });
    }
  }
  return fused;
}
