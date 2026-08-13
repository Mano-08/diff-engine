// src/pipeline/orchestrator.ts

import { prisma } from "../db/prisma";
import { uploadFileToCloudinary } from "../services/storage";
import { withJobDir } from "./jobDir";
import {
  extractAudio,
  extractThumbnails,
  probeHasAudio,
} from "./ffmpegExtract";
import { extractAudioCandidates, transcribeAudio } from "./audioCandidates";
import {
  buildNoiseMask,
  fuseVisualCandidates,
  ocrDiffCandidates,
  settlePatternCandidates,
} from "./visualCandidates";
import { mergeCandidates } from "./mergeCandidates";
import { selectBestFrames } from "./frameSelection";
import { dedupeScreenshots, enforceImageBudget } from "./dedupeAndBudget";
import {
  assembleMarkdown,
  generateDocumentation,
} from "./generateDocumentation";
import { AudioCandidate, TranscriptSegment } from "./types";

export async function processVideoIntoDoc(
  localVideoPath: string,
  documentId: string,
  versionId: string,
  mimeType: string,
): Promise<void> {
  const jobId = versionId;

  const result = await withJobDir(jobId, async (jobDir) => {
    // --- Stage 0: extraction ---
    const hasAudio = await probeHasAudio(localVideoPath);
    const thumbnails = await extractThumbnails(localVideoPath, jobDir, 1);

    // --- Stage 1: audio path ---
    let transcriptSegments: TranscriptSegment[] = [];
    let audioCandidates: AudioCandidate[] = [];
    if (hasAudio) {
      const wavPath = await extractAudio(localVideoPath, jobDir);
      transcriptSegments = await transcribeAudio(wavPath);
      audioCandidates = await extractAudioCandidates(transcriptSegments);
    }

    // --- Stage 2: visual path (always runs) ---
    const noiseMask = await buildNoiseMask(thumbnails);
    const settleCandidates = await settlePatternCandidates(
      thumbnails,
      noiseMask,
    );
    const gateIndices = settleCandidates
      .map((c) =>
        thumbnails.findIndex((t) => t.timestampSec === c.timestampSec),
      )
      .filter((i) => i >= 0);
    const ocrCandidates = await ocrDiffCandidates(thumbnails, gateIndices);
    const visualCandidates = fuseVisualCandidates(
      settleCandidates,
      ocrCandidates,
    );

    // --- Stage 3: merge ---
    const merged = mergeCandidates(
      audioCandidates,
      visualCandidates,
      transcriptSegments,
    );

    // --- Stage 4: best-frame selection per window ---
    const selected = await selectBestFrames(localVideoPath, jobDir, merged);

    // --- Stage 5: dedupe + budget ---
    const deduped = await dedupeScreenshots(selected);
    const budgeted = await enforceImageBudget(deduped);

    // --- Stage 6: final Claude call (only place images are sent) ---
    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
    });
    const { documentTitle, steps } = await generateDocumentation(
      budgeted,
      doc.title,
    );

    // --- Upload video + selected screenshots to Cloudinary before cleanup ---
    const sourceVideoUrl = await uploadFileToCloudinary(
      localVideoPath,
      "video",
      { jobId, documentId, versionId } as any, // match your actual UploadJobContext shape
      mimeType,
    );

    const stepsWithUrls = await Promise.all(
      steps.map(async (step) => {
        const screenshotUrl = await uploadFileToCloudinary(
          step.screenshotLocalPath,
          "screenshot" as any, // match your actual AssetType
          { jobId, documentId, versionId } as any,
        );
        return { ...step, screenshotUrl };
      }),
    );

    const markdown = assembleMarkdown(documentTitle, stepsWithUrls);
    return { sourceVideoUrl, stepsWithUrls, markdown, documentTitle };
  });

  await prisma.$transaction([
    prisma.docVersion.update({
      where: { id: versionId },
      data: {
        status: "ready",
        sourceVideoUrl: result.sourceVideoUrl,
        contentJson: { markdown: result.markdown, title: result.documentTitle },
      },
    }),
    ...result.stepsWithUrls.map((step) =>
      prisma.step.create({
        data: {
          docVersionId: versionId,
          orderIndex: step.orderIndex,
          title: step.title,
          bodyText: step.bodyText,
          screenshotUrl: step.screenshotUrl,
        },
      }),
    ),
  ]);
}
