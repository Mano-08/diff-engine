// src/pipeline/dedupeAndBudget.ts

import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { SelectedScreenshot } from "./types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_IMAGES = 25;

async function averageHash(imagePath: string): Promise<bigint> {
  const { data } = await sharp(imagePath)
    .grayscale()
    .resize(8, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  let hash = 0n;
  for (let i = 0; i < data.length; i++) {
    hash = (hash << 1n) | (data[i] > mean ? 1n : 0n);
  }
  return hash;
}

function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/**
 * Stage 5a: drops near-duplicate screenshots (common with slow narration
 * over an unchanging screen) using perceptual hashing.
 */
export async function dedupeScreenshots(
  screenshots: SelectedScreenshot[],
  hammingThreshold = 6,
): Promise<SelectedScreenshot[]> {
  const sorted = [...screenshots].sort(
    (a, b) => a.candidate.timestampSec - b.candidate.timestampSec,
  );
  const kept: SelectedScreenshot[] = [];
  const keptHashes: bigint[] = [];

  for (const s of sorted) {
    const hash = await averageHash(s.framePath);
    const isDup = keptHashes.some(
      (h) => hammingDistance(h, hash) <= hammingThreshold,
    );
    if (!isDup) {
      kept.push(s);
      keptHashes.push(hash);
    }
  }
  return kept;
}

/**
 * Stage 5b: if still over budget, ask Claude (text-only, no images yet) to
 * rank/merge steps by documentation importance down to MAX_IMAGES.
 */
export async function enforceImageBudget(
  screenshots: SelectedScreenshot[],
  maxImages = MAX_IMAGES,
): Promise<SelectedScreenshot[]> {
  if (screenshots.length <= maxImages) return screenshots;

  const stepList = screenshots
    .map(
      (s, i) =>
        `${i}. t=${s.candidate.timestampSec.toFixed(1)}s - ${s.candidate.reasons.join("; ")}` +
        (s.candidate.transcriptSnippet
          ? ` - "${s.candidate.transcriptSnippet}"`
          : ""),
    )
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system:
      `You are trimming a documentation step list down to at most ${maxImages} entries. ` +
      "Keep the steps most useful for a reader following the workflow; merge adjacent minor " +
      "steps and drop redundant or low-value ones. Respond ONLY with a JSON array of the " +
      "integer indices to keep, in original order, nothing else.",
    messages: [{ role: "user", content: stepList }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const indices: number[] = JSON.parse((textBlock as any)?.text ?? "[]");

  return indices.map((i) => screenshots[i]).filter(Boolean);
}
