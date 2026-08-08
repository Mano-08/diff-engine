// src/services/audioProcessor.ts
import ffmpeg from "fluent-ffmpeg";
import path from "path";
import { nanoid } from "nanoid";
import fs from "fs";

const TMP_DIR = path.resolve("tmp");

export interface TranscriptSegment {
  text: string;
  startSec: number;
  endSec: number;
}

// Checks whether the video actually has an audio stream before attempting extraction
function hasAudioTrack(videoPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      const hasAudio = metadata.streams.some((s) => s.codec_type === "audio");
      resolve(hasAudio);
    });
  });
}

function extractAudioTrack(videoPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const outputPath = path.join(TMP_DIR, `${nanoid()}.mp3`);

    ffmpeg(videoPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .output(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", reject)
      .run();
  });
}

function audioSegmentsToTimestamps(segments: TranscriptSegment[]): number[] {
  return segments.map((s) => s.endSec);
}

async function transcribeWithTimestamps(
  audioPath: string,
): Promise<TranscriptSegment[]> {
  const fileBuffer = await fs.promises.readFile(audioPath);
  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), "audio.mp3");
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json"); // gives per-segment timestamps
  formData.append("timestamp_granularities[]", "segment");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(
      `Whisper transcription failed: ${res.status} ${await res.text()}`,
    );
  }

  const json = (await res.json()) as {
    segments?: { text: string; start: number; end: number }[];
  };

  return (json.segments ?? []).map((s) => ({
    text: s.text.trim(),
    startSec: s.start,
    endSec: s.end,
  }));
}

export async function getAudioDerivedTimestamps(videoPath: string): Promise<{
  timestamps: number[];
  transcript: TranscriptSegment[];
}> {
  const hasAudio = await hasAudioTrack(videoPath).catch(() => false); // ffprobe failure → assume no audio, don't crash

  if (!hasAudio) {
    console.log("No audio track detected — proceeding visual-only.");
    return { timestamps: [], transcript: [] };
  }

  const audioPath = await extractAudioTrack(videoPath);

  try {
    const transcript = await transcribeWithTimestamps(audioPath);
    return { timestamps: audioSegmentsToTimestamps(transcript), transcript };
  } finally {
    try {
      await fs.promises.unlink(audioPath);
    } catch (err) {
      console.warn("Failed to remove temporary audio file:", err);
    }
  }
}
