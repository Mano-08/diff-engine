import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "fs";
import { prisma } from "../db/prisma.js";
import { extractKeyFrames } from "../services/video";
import { structureStepsFromFramesBatched } from "../services/structuring.js";
import { embedTexts } from "../services/embeddings.js";
import { generateStepDiffs } from "../services/diffing.js";
import type { StepDiffEntry, StepWithScreenshot } from "../types.js";
import { Prisma, Step } from "../../generated/prisma/client.js";
import { InputJsonValue } from "@prisma/client/runtime/client";
import { uploadFileToCloudinary } from "../services/storage.js";

function toJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function fromJson<T>(value: Prisma.JsonValue): T {
  return value as unknown as T;
}

const router = Router();
import path from "path";

const upload = multer({
  storage: multer.diskStorage({
    destination: "tmp/uploads/",
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".mp4"; // fallback just in case
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
});

// ── GET /api/documents — list all documents + latest version status (sidebar) ──
router.get("/", async (_req: Request, res: Response) => {
  const documents = await prisma.document.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { id: true, versionNumber: true, status: true },
      },
    },
  });

  const summaries = documents
    .filter((doc) => doc.versions.length > 0)
    .map((doc) => ({
      id: doc.id,
      title: doc.title,
      createdAt: doc.createdAt,
      latestVersion: doc.versions[0],
    }));

  res.json(summaries);
});

// ── POST /api/documents — create doc + version 1 from uploaded video ──
router.post(
  "/",
  upload.single("video"),
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "video file is required" });
      return;
    }

    const title = (req.body.title as string) || "Untitled Document";

    const document = await prisma.document.create({ data: { title } });
    const version = await prisma.docVersion.create({
      data: { documentId: document.id, versionNumber: 1, status: "processing" },
    });

    res.status(202).json({
      documentId: document.id,
      versionId: version.id,
      status: "processing",
    });

    processVideoIntoDoc(
      file.path,
      document.id,
      version.id,
      file.mimetype,
    ).catch(async (err) => {
      console.error("Processing failed:", err);
      await markVersionFailed(version.id, err);
    });
  },
);

router.patch(
  "/:id/versions/:versionId/content",
  async (req: Request, res: Response) => {
    const { id: documentId, versionId } = req.params;
    const { content } = req.body as { content?: unknown };

    if (typeof documentId !== "string") {
      res.status(400).json({ error: "invalid document id" });
      return;
    }

    if (typeof versionId !== "string") {
      res.status(400).json({ error: "invalid version id" });
      return;
    }

    if (!content || typeof content !== "object") {
      res
        .status(400)
        .json({ error: "content (ProseMirror JSON object) is required" });
      return;
    }

    const version = await prisma.docVersion.findFirst({
      where: { id: versionId, documentId },
    });

    if (!version) {
      res.status(404).json({ error: "version not found" });
      return;
    }

    try {
      await prisma.docVersion.update({
        where: { id: versionId },
        data: { contentJson: content as unknown as Prisma.InputJsonValue },
      });

      res.status(204).send();
    } catch (err) {
      console.error("Failed to save document content:", err);
      res.status(500).json({ error: "failed to save content" });
    }
  },
);

// ── GET /api/documents/:id — full document, ALL versions, each with steps ──
router.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  if (typeof id !== "string") {
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      versions: {
        orderBy: { versionNumber: "asc" },
        include: { steps: { orderBy: { orderIndex: "asc" } } },
      },
    },
  });

  if (!document) {
    res.status(404).json({ error: "not found" });
    return;
  }

  res.json(document);
});

// ── POST /api/documents/:id/versions — regenerate: new video → new version N ──
router.post(
  "/:id/versions",
  upload.single("video"),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (typeof id !== "string") {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "video file is required" });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id },
    });
    if (!document) {
      res.status(404).json({ error: "document not found" });
      return;
    }

    const latestVersion = await prisma.docVersion.findFirst({
      where: { documentId: document.id },
      orderBy: { versionNumber: "desc" },
    });
    const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

    const version = await prisma.docVersion.create({
      data: {
        documentId: document.id,
        versionNumber: nextVersionNumber,
        status: "processing",
      },
    });

    res.status(202).json({
      documentId: document.id,
      versionId: version.id,
      status: "processing",
    });

    processVideoIntoDoc(
      file.path,
      document.id,
      version.id,
      file.mimetype,
    ).catch(async (err) => {
      console.error("Processing failed:", err);
      await markVersionFailed(version.id, err);
    });
  },
);

// ── GET /api/documents/:id/versions/:versionId/diff — diff vs previous version ──
router.get(
  "/:id/versions/:versionId/diff",
  async (req: Request, res: Response) => {
    const { id: documentId, versionId } = req.params;

    if (typeof versionId !== "string") {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    if (typeof documentId !== "string") {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    const newVersion = await prisma.docVersion.findFirst({
      where: { id: versionId, documentId },
      include: { steps: { orderBy: { orderIndex: "asc" } } },
    });

    if (!newVersion) {
      res.status(404).json({ error: "version not found" });
      return;
    }

    if (newVersion.versionNumber <= 1) {
      res
        .status(400)
        .json({ error: "version 1 has no previous version to diff against" });
      return;
    }

    const oldVersion = await prisma.docVersion.findFirst({
      where: { documentId, versionNumber: newVersion.versionNumber - 1 },
      include: { steps: { orderBy: { orderIndex: "asc" } } },
    });

    if (!oldVersion) {
      res.status(404).json({ error: "previous version not found" });
      return;
    }

    // upsert instead of findUnique-then-create — collapses concurrent
    // requests into a single row instead of racing on the unique constraint
    let diffRecord;
    try {
      const stepDiffs = await computeOrReuseStepDiffs(
        oldVersion.id,
        newVersion.id,
        oldVersion.steps,
        newVersion.steps,
      );
      diffRecord = await prisma.diff.upsert({
        where: {
          oldVersionId_newVersionId: {
            oldVersionId: oldVersion.id,
            newVersionId: newVersion.id,
          },
        },
        update: {}, // if it already exists, don't touch it — just return it
        create: {
          oldVersionId: oldVersion.id,
          newVersionId: newVersion.id,
          stepDiffs: stepDiffs as unknown as InputJsonValue,
        },
      });
    } catch (err) {
      console.error("Diff generation/upsert failed:", err);
      res.status(500).json({ error: "failed to generate diff" });
      return;
    }

    // hydrate IDs into full Step objects for the response —
    // this is what the frontend actually renders
    const hydrated = hydrateStepDiffs(
      diffRecord.stepDiffs as unknown as StepDiffEntry[],
      oldVersion.steps,
      newVersion.steps,
    );

    res.json({
      id: diffRecord.id,
      oldVersionId: diffRecord.oldVersionId,
      newVersionId: diffRecord.newVersionId,
      stepDiffs: hydrated,
    });
  },
);

// Only computes the diff if it doesn't already exist — avoids redundant
// embedding/pixel-diff work when upsert's `update: {}` branch fires
async function computeOrReuseStepDiffs(
  oldVersionId: string,
  newVersionId: string,
  oldSteps: Step[],
  newSteps: Step[],
) {
  const existing = await prisma.diff.findUnique({
    where: { oldVersionId_newVersionId: { oldVersionId, newVersionId } },
  });
  if (existing) return existing.stepDiffs as unknown as StepDiffEntry[];

  return generateStepDiffs(oldSteps, newSteps);
}

function hydrateStepDiffs(
  stepDiffs: StepDiffEntry[],
  oldSteps: Step[],
  newSteps: Step[],
) {
  const oldById = new Map(oldSteps.map((s) => [s.id, s]));
  const newById = new Map(newSteps.map((s) => [s.id, s]));

  return stepDiffs.map((entry) => ({
    type: entry.type,
    oldStep: entry.oldStepId ? (oldById.get(entry.oldStepId) ?? null) : null,
    newStep: entry.newStepId ? (newById.get(entry.newStepId) ?? null) : null,
    changedRegions: entry.changedRegions ?? [],
  }));
}

// ── shared processing pipeline ──

async function processVideoIntoDoc(
  localVideoPath: string,
  documentId: string,
  versionId: string,
  videoMimeType: string,
): Promise<void> {
  // 1. upload raw video to Cloudinary
  const videoUrl = await uploadFileToCloudinary(
    localVideoPath,
    "videos",
    { documentId, versionId },
    videoMimeType,
  );
  await prisma.docVersion.update({
    where: { id: versionId },
    data: { sourceVideoUrl: videoUrl },
  });

  // 2. derive candidate timestamps from narration audio (best-effort — degrades gracefully)
  const { timestamps: audioTimestamps, transcript } =
    await getAudioDerivedTimestamps(localVideoPath).catch((err) => {
      console.error("Audio transcription failed, continuing visual-only:", err);
      return { timestamps: [], transcript: [] };
    });

  // 3. extract settled keyframes — called ONCE, result reused throughout
  const frames = await extractKeyFrames(localVideoPath, audioTimestamps);

  // 4. structure frames (+ transcript context) into steps via Claude
  const structuredSteps = await structureStepsFromFramesBatched(
    frames,
    transcript,
  );

  // 5. upload only the frames selected as steps
  const stepsWithUrls: StepWithScreenshot[] = [];
  for (let i = 0; i < structuredSteps.length; i++) {
    const step = structuredSteps[i];
    const frame = frames[step.frame_index]; // same `frames` array used in step 4 — indices now actually correspond
    const screenshotUrl = await uploadFileToCloudinary(
      frame.path,
      "screenshots",
      { documentId, versionId, stepIndex: i },
      // no mimetype override needed — uploadFileToCloudinary defaults to image detection for non-video paths
    );
    stepsWithUrls.push({ ...step, screenshotUrl });
  }

  // 6. embed step text for later diffing
  const embeddings = await embedTexts(
    stepsWithUrls.map((s) => `${s.title}. ${s.body_text}`),
  );

  // 7. persist steps atomically
  await prisma.$transaction(
    stepsWithUrls.map((step, i) =>
      prisma.step.create({
        data: {
          docVersionId: versionId,
          orderIndex: i,
          title: step.title,
          bodyText: step.body_text,
          screenshotUrl: step.screenshotUrl,
          embedding: embeddings[i],
        },
      }),
    ),
  );

  await prisma.docVersion.update({
    where: { id: versionId },
    data: { status: "ready" },
  });

  // 8. cleanup local temp files
  fs.unlinkSync(localVideoPath);
  frames.forEach((f) => {
    try {
      fs.unlinkSync(f.path);
    } catch {
      /* already removed */
    }
  });
}

async function markVersionFailed(
  versionId: string,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await prisma.docVersion.update({
    where: { id: versionId },
    data: { status: "failed", errorMessage: message },
  });
}

import { v2 as cloudinary } from "cloudinary";
import { getAudioDerivedTimestamps } from "../services/audioProcessor.js";

// ── DELETE /api/documents/:id/versions/:versionId ──
router.delete(
  "/:id/versions/:versionId",
  async (req: Request, res: Response) => {
    const { id: documentId, versionId } = req.params;

    if (typeof documentId !== "string") {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    if (typeof versionId !== "string") {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    const version = await prisma.docVersion.findFirst({
      where: { id: versionId, documentId },
    });

    if (!version) {
      res.status(404).json({ error: "version not found" });
      return;
    }

    const latestVersion = await prisma.docVersion.findFirst({
      where: { documentId },
      orderBy: { versionNumber: "desc" },
    });

    if (latestVersion?.id !== version.id) {
      res.status(400).json({
        error:
          "only the latest version can be deleted, to keep version numbering and diffs consistent",
      });
      return;
    }

    const isOnlyVersion = version.versionNumber === 1;
    const totalVersionCount = await prisma.docVersion.count({
      where: { documentId },
    });

    if (isOnlyVersion && totalVersionCount === 1) {
      res.status(400).json({
        error:
          "cannot delete the only version of a document — delete the document instead",
      });
      return;
    }

    try {
      // 1. delete Cloudinary assets for this job (best-effort — don't block DB cleanup on this)
      await Promise.allSettled([
        cloudinary.api.delete_resources_by_prefix(
          `diff-engine/videos/${documentId}/${versionId}`,
        ),
        cloudinary.api.delete_resources_by_prefix(
          `diff-engine/screenshots/${documentId}/${versionId}`,
        ),
      ]);

      // 2. delete DB rows in dependency order — Diff and Step both reference DocVersion
      await prisma.$transaction([
        prisma.diff.deleteMany({
          where: {
            OR: [{ oldVersionId: versionId }, { newVersionId: versionId }],
          },
        }),
        prisma.step.deleteMany({ where: { docVersionId: versionId } }),
        prisma.docVersion.delete({ where: { id: versionId } }),
      ]);

      res.status(204).send();
    } catch (err) {
      console.error("Failed to delete version:", err);
      res.status(500).json({ error: "failed to delete version" });
    }
  },
);

// ── DELETE /api/documents/:id/versions/:versionId ──
router.delete(
  "/:id/versions/:versionId",
  async (req: Request, res: Response) => {
    const { id: documentId, versionId } = req.params;

    if (typeof documentId !== "string") {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    if (typeof versionId !== "string") {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    const version = await prisma.docVersion.findFirst({
      where: { id: versionId, documentId },
    });

    if (!version) {
      res.status(404).json({ error: "version not found" });
      return;
    }

    if (version.status === "processing") {
      res
        .status(400)
        .json({ error: "cannot delete a version that is still processing" });
      return;
    }

    const totalVersionCount = await prisma.docVersion.count({
      where: { documentId },
    });
    if (totalVersionCount === 1) {
      res.status(400).json({
        error:
          "cannot delete the only version of a document — delete the document instead",
      });
      return;
    }

    try {
      await Promise.allSettled([
        cloudinary.api.delete_resources_by_prefix(
          `diff-engine/videos/${documentId}/${versionId}`,
        ),
        cloudinary.api.delete_resources_by_prefix(
          `diff-engine/screenshots/${documentId}/${versionId}`,
        ),
      ]);

      await prisma.$transaction([
        // any diff where this version is EITHER side becomes invalid once it's gone
        prisma.diff.deleteMany({
          where: {
            OR: [{ oldVersionId: versionId }, { newVersionId: versionId }],
          },
        }),
        prisma.step.deleteMany({ where: { docVersionId: versionId } }),
        prisma.docVersion.delete({ where: { id: versionId } }),
      ]);

      res.status(204).send();
    } catch (err) {
      console.error("Failed to delete version:", err);
      res.status(500).json({ error: "failed to delete version" });
    }
  },
);

export default router;
