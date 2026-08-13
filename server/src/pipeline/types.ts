// src/pipeline/types.ts

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface AudioCandidate {
  startSec: number;
  endSec: number;
  reason: string;
  confidence: number; // 0-1
  source: "audio";
}

export interface VisualCandidate {
  timestampSec: number;
  reason: string;
  score: number; // fused score, higher = more likely a real step
  source: "visual";
}

export interface MergedCandidate {
  timestampSec: number;
  windowStartSec: number;
  windowEndSec: number;
  transcriptSnippet?: string;
  reasons: string[];
  score: number;
}

export interface ThumbnailFrame {
  index: number;
  timestampSec: number;
  path: string;
}

export interface SelectedScreenshot {
  candidate: MergedCandidate;
  framePath: string;
  sharpness: number;
  stability: number;
}

export interface FinalStep {
  orderIndex: number;
  title: string;
  bodyText: string;
  screenshotLocalPath: string;
  timestampSec: number;
}
