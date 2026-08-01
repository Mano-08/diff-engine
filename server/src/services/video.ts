import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const TMP_DIR = path.resolve("tmp");
const MAX_FRAMES = 25;

const SAMPLE_INTERVAL_SEC = 0.5;
const SETTLE_CHECK_DELAY_MS = 400;
const SETTLE_DIFF_THRESHOLD = 0.02;
const MAX_SETTLE_ATTEMPTS = 3;
const MERGE_WINDOW_SEC = 1.5;
const SPIKE_STD_DEV_MULTIPLIER = 2;
const SPIKE_MIN_DIFF_FLOOR = 0.05;

export interface ExtractedFrame {
  path: string;
  timestampSec: number;
}

interface DiffTimelinePoint {
  t: number;
  diff: number;
}

// ── main entry point — replaces the old scene-threshold extractKeyFrames ──
// in extractKeyFrames, after computing durationSec (you already fetch this
// in computeFrameDiffTimeline — hoist it up so extractKeyFrames has it too)

export async function extractKeyFrames(
  videoPath: string,
  audioTimestamps: number[] = [],
): Promise<ExtractedFrame[]> {
  const durationSec = await getVideoDuration(videoPath);

  const outputDir = path.join(TMP_DIR, nanoid());
  fs.mkdirSync(outputDir, { recursive: true });

  const diffTimeline = await computeFrameDiffTimeline(
    videoPath,
    outputDir,
    durationSec,
  );
  const visualTimestamps = detectAdaptiveVisualTimestamps(diffTimeline);

  const rawCandidates = mergeAndDedupeTimestamps(
    audioTimestamps,
    visualTimestamps,
  );

  // clamp everything to a safe range — leave enough headroom for the
  // settle-check's max delay so waitForStableFrame never seeks past duration
  const SETTLE_HEADROOM_SEC =
    (SETTLE_CHECK_DELAY_MS * MAX_SETTLE_ATTEMPTS * 2) / 1000;
  const candidateTimestamps = rawCandidates
    .filter((t) => t < durationSec - 0.1) // drop anything essentially at the very end
    .map((t) => Math.min(t, Math.max(0, durationSec - SETTLE_HEADROOM_SEC)));

  if (candidateTimestamps.length === 0) {
    const fallback = await extractFallbackFrames(videoPath, outputDir);
    return capFrameCount(fallback);
  }

  const settledFrames: ExtractedFrame[] = [];
  for (const timestamp of candidateTimestamps) {
    const framePath = await waitForStableFrame(
      videoPath,
      timestamp,
      outputDir,
      durationSec,
    ).catch((err) => {
      console.error(
        `Skipping timestamp ${timestamp}s — settle extraction failed:`,
        err.message,
      );
      return null;
    });
    if (framePath)
      settledFrames.push({ path: framePath, timestampSec: timestamp });
  }

  return capFrameCount(settledFrames);
}
async function waitForStableFrame(
  videoPath: string,
  baseTimestamp: number,
  outputDir: string,
  durationSec: number,
): Promise<string | null> {
  for (let attempt = 1; attempt <= MAX_SETTLE_ATTEMPTS; attempt++) {
    const delaySeconds = (SETTLE_CHECK_DELAY_MS * attempt) / 1000;
    const t1 = Math.min(baseTimestamp + delaySeconds, durationSec - 0.05);
    const t2 = Math.min(t1 + SETTLE_CHECK_DELAY_MS / 1000, durationSec - 0.02);

    if (t1 >= durationSec || t2 >= durationSec || t1 >= t2) continue; // no valid window left, try next attempt or give up

    try {
      const frame1 = await extractFrameAt(videoPath, t1, outputDir);
      const frame2 = await extractFrameAt(videoPath, t2, outputDir);

      const diff = await computeFrameDifference(frame1, frame2);

      if (diff < SETTLE_DIFF_THRESHOLD) {
        fs.unlinkSync(frame2);
        return frame1;
      }

      fs.unlinkSync(frame1);
      fs.unlinkSync(frame2);
    } catch (err) {
      console.error(
        `Frame extraction failed at attempt ${attempt} (t1=${t1}, t2=${t2}):`,
        err,
      );
      // fall through to next attempt rather than crashing the whole pipeline
    }
  }

  return null;
}
// ── layer 1: sample the video at fixed intervals, compute pixel diff at each step ──

async function computeFrameDiffTimeline(
  videoPath: string,
  outputDir: string,
  durationSec: number,
): Promise<DiffTimelinePoint[]> {
  // const durationSec = await getVideoDuration(videoPath);
  const timeline: DiffTimelinePoint[] = [];
  let previousFramePath: string | null = null;

  for (let t = 0; t < durationSec; t += SAMPLE_INTERVAL_SEC) {
    const framePath = await extractFrameAt(videoPath, t, outputDir);

    if (previousFramePath) {
      const diff = await computeFrameDifference(previousFramePath, framePath);
      timeline.push({ t, diff });
      fs.unlinkSync(previousFramePath);
    }

    previousFramePath = framePath;
  }

  if (previousFramePath) fs.unlinkSync(previousFramePath);

  return timeline;
}

// ── layer 2: flag local spikes in the diff timeline, not a fixed global threshold ──

function detectAdaptiveVisualTimestamps(
  diffScores: DiffTimelinePoint[],
): number[] {
  const WINDOW = 10;
  const candidates: number[] = [];

  for (let i = WINDOW; i < diffScores.length; i++) {
    const window = diffScores.slice(i - WINDOW, i);
    const avg = window.reduce((sum, d) => sum + d.diff, 0) / WINDOW;
    const stdDev = Math.sqrt(
      window.reduce((sum, d) => sum + (d.diff - avg) ** 2, 0) / WINDOW,
    );

    const isSpike =
      diffScores[i].diff > avg + SPIKE_STD_DEV_MULTIPLIER * stdDev &&
      diffScores[i].diff > SPIKE_MIN_DIFF_FLOOR;

    if (isSpike) candidates.push(diffScores[i].t);
  }

  return candidates;
}

// ── merge audio-derived and visual-derived candidate timestamps ──

function mergeAndDedupeTimestamps(
  audioTimestamps: number[],
  visualTimestamps: number[],
): number[] {
  const all = [...audioTimestamps, ...visualTimestamps].sort((a, b) => a - b);
  const merged: number[] = [];

  for (const t of all) {
    if (
      merged.length === 0 ||
      t - merged[merged.length - 1] > MERGE_WINDOW_SEC
    ) {
      merged.push(t);
    }
  }

  return merged;
}

// ── shared low-level helpers ──

function extractFrameAt(
  videoPath: string,
  timestampSec: number,
  outputDir: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const outPath = path.join(outputDir, `${nanoid()}.png`);

    ffmpeg(videoPath)
      .seekInput(Math.max(0, timestampSec))
      .frames(1)
      .output(outPath)
      .on("end", () => {
        // ffmpeg can exit 'end' successfully while writing zero frames
        // (e.g. seeking past the video's duration) — verify the file
        // actually landed on disk before trusting this as a real frame
        if (!fs.existsSync(outPath)) {
          reject(
            new Error(
              `ffmpeg produced no output frame at timestamp ${timestampSec}s (likely past video duration)`,
            ),
          );
          return;
        }
        resolve(outPath);
      })
      .on("error", reject)
      .run();
  });
}

async function computeFrameDifference(
  pathA: string,
  pathB: string,
): Promise<number> {
  const [a, b] = await Promise.all([
    sharp(pathA).resize(200, 112).grayscale().raw().toBuffer(),
    sharp(pathB).resize(200, 112).grayscale().raw().toBuffer(),
  ]);

  let diffSum = 0;
  for (let i = 0; i < a.length; i++) diffSum += Math.abs(a[i] - b[i]);
  return diffSum / (a.length * 255);
}

function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration ?? 0);
    });
  });
}

// ── fallback path — only hit if literally nothing was detected ──

function extractFallbackFrames(
  videoPath: string,
  outputDir: string,
): Promise<ExtractedFrame[]> {
  return new Promise((resolve, reject) => {
    const outputPattern = path.join(outputDir, "fallback-%04d.png");
    ffmpeg(videoPath)
      .outputOptions(["-vf", "fps=1/3"])
      .output(outputPattern)
      .on("end", () => {
        const files = fs
          .readdirSync(outputDir)
          .filter((f) => f.startsWith("fallback-") && f.endsWith(".png"))
          .sort()
          .map((f, i) => ({
            path: path.join(outputDir, f),
            timestampSec: i * 3,
          }));
        resolve(files);
      })
      .on("error", reject)
      .run();
  });
}

function capFrameCount(frames: ExtractedFrame[]): ExtractedFrame[] {
  if (frames.length <= MAX_FRAMES) return frames;

  const step = frames.length / MAX_FRAMES;
  const sampled: ExtractedFrame[] = [];
  for (let i = 0; i < MAX_FRAMES; i++) {
    sampled.push(frames[Math.floor(i * step)]);
  }
  return sampled;
}
