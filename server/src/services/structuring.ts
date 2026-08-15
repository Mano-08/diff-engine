import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import type { StructuredStep } from "../types.js";
import type { ExtractedFrame } from "./video.js";
import type { TranscriptSegment } from "./audio.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BATCH_SIZE = 25;
const OVERLAP = 2;
const NEARBY_TRANSCRIPT_WINDOW_SEC = 3;

interface FrameBatch {
  frames: ExtractedFrame[];
  startIndex: number;
  overlapCount: number;
}

function createOverlappingBatches(
  frames: ExtractedFrame[],
  batchSize: number,
  overlap: number,
): FrameBatch[] {
  if (frames.length === 0) return [];

  if (batchSize <= 0) {
    throw new Error("batchSize must be greater than 0");
  }

  if (overlap < 0 || overlap >= batchSize) {
    throw new Error("overlap must be >= 0 and less than batchSize");
  }

  const batches: FrameBatch[] = [];
  const step = batchSize - overlap;

  for (let start = 0; start < frames.length; start += step) {
    const end = Math.min(start + batchSize, frames.length);

    batches.push({
      frames: frames.slice(start, end),
      startIndex: start,
      overlapCount: start === 0 ? 0 : Math.min(overlap, start),
    });

    if (end === frames.length) break;
  }

  return batches;
}

/**
 * Drops any incoming step whose (already-remapped, absolute) frame_index
 * was also produced by a previous batch — overlap frames get shown to
 * Claude twice on purpose (for continuity context), so the same UI moment
 * can otherwise get documented twice at the seam.
 */
function mergeAvoidingDuplicateAtSeam(
  existing: StructuredStep[],
  incoming: StructuredStep[],
): StructuredStep[] {
  if (existing.length === 0) return incoming;

  const usedFrameIndices = new Set(existing.map((s) => s.frame_index));
  const deduped = incoming.filter((s) => !usedFrameIndices.has(s.frame_index));
  return [...existing, ...deduped];
}

// ── transcript lookup ──
function findNearbyTranscriptSegment(
  transcript: TranscriptSegment[],
  timestampSec: number,
  windowSec = NEARBY_TRANSCRIPT_WINDOW_SEC,
): TranscriptSegment | undefined {
  return transcript.find(
    (s) =>
      s.endSec >= timestampSec - windowSec &&
      s.startSec <= timestampSec + windowSec,
  );
}

// ── system prompt ──
function buildSystemPrompt(
  previousStepContext: string | null,
  overlapCount: number,
): string {
  const base =
    "You are documenting a software workflow from a sequence of screenshots, in order. " +
    "For each screenshot that shows a distinct, documentable UI action (clicking a button, " +
    "opening a menu, typing into a field, navigating to a new screen), output a step. " +
    "Skip frames that don't represent a new action (e.g. a screen that hasn't changed, or " +
    "mid-transition/loading states). Only document what's visibly shown or explicitly " +
    "narrated - never invent buttons, menus, or actions that aren't in the evidence.\n\n" +
    "Respond ONLY with a JSON array, no prose, no markdown fences, matching this shape:\n" +
    '[{ "frame_index": number, "title": string, "body_text": string }]\n' +
    'frame_index must match the "Frame index N" label given before each image.';

  const overlapNote =
    overlapCount > 0
      ? `\n\nThe first ${overlapCount} frame(s) in this batch were also shown in the previous ` +
        "batch, purely for continuity - do not re-document them unless something about them " +
        "was missed."
      : "";

  const contextNote = previousStepContext
    ? `\n\nThe last documented step so far was: "${previousStepContext}". Continue from there.`
    : "";

  return base + overlapNote + contextNote;
}

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

// single-batch Claude call

type ImageContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: "image/jpeg"; data: string };
    };

async function toCompressedBase64(framePath: string): Promise<string> {
  const buf = await sharp(framePath)
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return buf.toString("base64");
}

async function structureStepsFromFrames(
  frames: ExtractedFrame[],
  transcript: TranscriptSegment[],
  previousStepContext: string | null,
  overlapCount: number,
): Promise<StructuredStep[]> {
  const imageBlocks: ImageContentBlock[] = [];

  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    const nearbySegment = findNearbyTranscriptSegment(
      transcript,
      frame.timestampSec,
    );

    if (nearbySegment) {
      imageBlocks.push({
        type: "text",
        text: `Narration near this frame: "${nearbySegment.text}"`,
      });
    }

    imageBlocks.push({ type: "text", text: `Frame index ${index}:` });
    imageBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: await toCompressedBase64(frame.path),
      },
    });
  }

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
