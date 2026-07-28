import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const TMP_DIR = path.resolve("tmp");
const MAX_FRAMES = 25;

export function extractKeyFrames(videoPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const outputDir = path.join(TMP_DIR, nanoid());
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPattern = path.join(outputDir, "frame-%04d.png");

    ffmpeg(videoPath)
      .outputOptions([
        "-vf select='gt(scene,0.3)',setpts=N/FRAME_RATE/TB",
        "-vsync",
        "vfr",
      ])
      .output(outputPattern)
      .on("end", async () => {
        const files = readSortedFrames(outputDir);

        if (files.length === 0) {
          try {
            const fallback = await extractFallbackFrames(videoPath, outputDir);
            resolve(capFrameCount(fallback));
          } catch (err) {
            reject(err);
          }
          return;
        }

        resolve(capFrameCount(files));
      })
      .on("error", reject)
      .run();
  });
}

function extractFallbackFrames(
  videoPath: string,
  outputDir: string,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const outputPattern = path.join(outputDir, "fallback-%04d.png");
    ffmpeg(videoPath)
      .outputOptions(["-vf", "fps=1/3"]) // one frame every 3 seconds
      .output(outputPattern)
      .on("end", () => resolve(readSortedFrames(outputDir)))
      .on("error", reject)
      .run();
  });
}

function readSortedFrames(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => path.join(dir, f));
}

// Placeholder cap/sample step — swap in a real perceptual hash dedupe
// (e.g. `jimp` + average-hash) before this if too many near-duplicates slip through
function capFrameCount(files: string[]): string[] {
  if (files.length <= MAX_FRAMES) return files;

  const step = files.length / MAX_FRAMES;
  const sampled: string[] = [];
  for (let i = 0; i < MAX_FRAMES; i++) {
    sampled.push(files[Math.floor(i * step)]);
  }
  return sampled;
}
