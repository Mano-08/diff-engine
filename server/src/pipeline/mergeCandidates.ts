// src/pipeline/mergeCandidates.ts

import {
  AudioCandidate,
  MergedCandidate,
  TranscriptSegment,
  VisualCandidate,
} from "./types";

const CLUSTER_TOLERANCE_SEC = 2.5;
const WINDOW_PADDING_SEC = 1.5;

function findTranscriptSnippet(
  timestampSec: number,
  segments: TranscriptSegment[],
  paddingSec = 5,
): string | undefined {
  const relevant = segments.filter(
    (s) =>
      s.endSec >= timestampSec - paddingSec &&
      s.startSec <= timestampSec + paddingSec,
  );
  if (relevant.length === 0) return undefined;
  return relevant.map((s) => s.text).join(" ");
}

/**
 * Stage 3: merges audio + visual candidates, clustering anything within
 * CLUSTER_TOLERANCE_SEC. Audio is weighted higher when present - it's more
 * semantically reliable than pixel-derived signals.
 */
export function mergeCandidates(
  audioCandidates: AudioCandidate[],
  visualCandidates: VisualCandidate[],
  transcriptSegments: TranscriptSegment[],
): MergedCandidate[] {
  type Tagged = { timestampSec: number; reason: string; score: number };

  const tagged: Tagged[] = [
    ...audioCandidates.map((c) => ({
      timestampSec: (c.startSec + c.endSec) / 2,
      reason: c.reason,
      score: c.confidence * 1.5,
    })),
    ...visualCandidates.map((c) => ({
      timestampSec: c.timestampSec,
      reason: c.reason,
      score: c.score,
    })),
  ].sort((a, b) => a.timestampSec - b.timestampSec);

  const merged: MergedCandidate[] = [];

  for (const c of tagged) {
    const last = merged[merged.length - 1];
    if (last && c.timestampSec - last.timestampSec <= CLUSTER_TOLERANCE_SEC) {
      last.score += c.score;
      last.reasons.push(c.reason);
      last.timestampSec = (last.timestampSec + c.timestampSec) / 2;
    } else {
      merged.push({
        timestampSec: c.timestampSec,
        windowStartSec: Math.max(0, c.timestampSec - WINDOW_PADDING_SEC),
        windowEndSec: c.timestampSec + WINDOW_PADDING_SEC,
        reasons: [c.reason],
        score: c.score,
      });
    }
  }

  for (const m of merged) {
    m.windowStartSec = Math.max(0, m.timestampSec - WINDOW_PADDING_SEC);
    m.windowEndSec = m.timestampSec + WINDOW_PADDING_SEC;
    m.transcriptSnippet = findTranscriptSnippet(
      m.timestampSec,
      transcriptSegments,
    );
  }

  return merged.sort((a, b) => b.score - a.score);
}
