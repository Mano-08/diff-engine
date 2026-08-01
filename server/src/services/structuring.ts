import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import type { StructuredStep } from "../types.js";
import type { ExtractedFrame } from "./video";
import type { TranscriptSegment } from "./audioProcessor.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BATCH_SIZE = 25;
const OVERLAP = 2;
const NEARBY_TRANSCRIPT_WINDOW_SEC = 3;

// ── public entry point — call this one from documents.ts ──

export async function structureStepsFromFramesBatched(
  frames: ExtractedFrame[],
  transcript: TranscriptSegment[] = [],
): Promise<StructuredStep[]> {
  const batches = createOverlappingBatches(frames, BATCH_SIZE, OVERLAP);

  let allSteps: StructuredStep[] = [];
  let previousStepContext: string | null = null;

  for (const batch of batches) {
    const steps = await structureStepsFromFrames(
      batch.frames,
      transcript,
      previousStepContext,
      batch.overlapCount,
    );

    const remapped = steps.map((s) => ({
      ...s,
      frame_index: batch.startIndex + s.frame_index,
    }));

    allSteps = mergeAvoidingDuplicateAtSeam(allSteps, remapped);
    previousStepContext = allSteps.length
      ? `${allSteps[allSteps.length - 1].title} — ${allSteps[allSteps.length - 1].body_text}`
      : null;
  }

  return allSteps;
}

// ── single-batch Claude call ──

type ImageContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: "image/png"; data: string };
    };

async function structureStepsFromFrames(
  frames: ExtractedFrame[],
  transcript: TranscriptSegment[],
  previousStepContext: string | null,
  overlapCount: number,
): Promise<StructuredStep[]> {
  const imageBlocks: ImageContentBlock[] = frames.flatMap((frame, index) => {
    const nearbySegment = findNearbyTranscriptSegment(
      transcript,
      frame.timestampSec,
    );
    const blocks: ImageContentBlock[] = [];

    if (nearbySegment) {
      blocks.push({
        type: "text",
        text: `Narration near this frame: "${nearbySegment.text}"`,
      });
    }

    blocks.push({ type: "text", text: `Frame index ${index}:` });
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: fs.readFileSync(frame.path).toString("base64"),
      },
    });

    return blocks;
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: buildSystemPrompt(previousStepContext, overlapCount),
    messages: [{ role: "user", content: imageBlocks }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude response contained no text block");
  }

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned) as StructuredStep[];
  } catch {
    throw new Error(`Failed to parse Claude response as JSON: ${cleaned}`);
  }
}

// ── system prompt ──

function buildSystemPrompt(
  previousStepContext: string | null,
  overlapCount: number,
): string {
  let prompt = `You are given a sequence of screenshots taken from a screen recording, in chronological order, each labeled with its frame index. Some frames include nearby narration text, transcribed from the recording's audio — use it as strong evidence of user intent when present. Group frames into logical steps a user would take to complete the task shown. Merge frames that belong to the same action; skip frames that show nothing meaningful (transitions, blank loading screens, spinners, skeleton screens).

Return ONLY strict JSON, no prose, no markdown fences, in this shape:
[
  { "title": "short step title", "body_text": "1-2 sentence instruction", "frame_index": 0 }
]`;

  if (previousStepContext) {
    prompt += `\n\nContext: this is a continuation of a longer recording. The last step identified in the previous batch was: "${previousStepContext}".`;
  }

  if (overlapCount > 0) {
    prompt += `\n\nThe first ${overlapCount} frame(s) in this batch are repeated from the end of the previous batch, included only for continuity. Do NOT create a new step for them unless they reveal a genuinely new action beyond what was already captured. Only start describing new steps from frame index ${overlapCount} onward, unless the overlap frames show something new.`;
  }

  return prompt;
}

// ── batching with overlap, to preserve continuity across chunk boundaries ──

interface FrameBatch {
  frames: ExtractedFrame[];
  startIndex: number;
  overlapCount: number;
}

function createOverlappingBatches(
  frames: ExtractedFrame[],
  size: number,
  overlap: number,
): FrameBatch[] {
  const batches: FrameBatch[] = [];
  let start = 0;

  while (start < frames.length) {
    const end = Math.min(start + size, frames.length);
    batches.push({
      frames: frames.slice(start, end),
      startIndex: start,
      overlapCount: start === 0 ? 0 : overlap,
    });
    if (end === frames.length) break;
    start = end - overlap;
  }

  return batches;
}

function mergeAvoidingDuplicateAtSeam(
  existing: StructuredStep[],
  incoming: StructuredStep[],
): StructuredStep[] {
  if (existing.length === 0) return incoming;

  const lastExisting = existing[existing.length - 1];
  const firstIncoming = incoming[0];

  const isDuplicate =
    titleSimilarity(lastExisting.title, firstIncoming.title) > 0.8;
  return isDuplicate
    ? [...existing, ...incoming.slice(1)]
    : [...existing, ...incoming];
}

function titleSimilarity(a: string, b: string): number {
  // cheap placeholder — swap for embedding cosine similarity (you already
  // have this machinery in embeddings.ts for the diff feature) if this
  // proves too coarse in practice
  const normalize = (s: string) => s.toLowerCase().trim();
  return normalize(a) === normalize(b) ? 1 : 0;
}

// ── transcript proximity matching ──

function findNearbyTranscriptSegment(
  segments: TranscriptSegment[],
  frameTimestampSec: number,
): TranscriptSegment | null {
  let closest: TranscriptSegment | null = null;
  let closestDistance = Infinity;

  for (const segment of segments) {
    const distance =
      frameTimestampSec < segment.startSec
        ? segment.startSec - frameTimestampSec
        : frameTimestampSec > segment.endSec
          ? frameTimestampSec - segment.endSec
          : 0;

    if (distance < closestDistance) {
      closestDistance = distance;
      closest = segment;
    }
  }

  return closestDistance <= NEARBY_TRANSCRIPT_WINDOW_SEC ? closest : null;
}
