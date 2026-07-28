import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "fs";
import { prisma } from "../db/prisma.js";
import { uploadFileToR2 } from "../services/storage.js";
import { structureStepsFromFrames } from "../services/structuring.js";
import type { StepWithScreenshot } from "../types.js";
import { extractKeyFrames } from "../services/video.js";

const router = Router();
const upload = multer({ dest: "tmp/uploads/" });

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

    processVideoIntoDoc(file.path, version.id).catch(async (err: unknown) => {
      console.error("Processing failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      await prisma.docVersion.update({
        where: { id: version.id },
        data: { status: "failed", errorMessage: message },
      });
    });
  },
);

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
        orderBy: { versionNumber: "desc" },
        take: 1,
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

async function processVideoIntoDoc(
  localVideoPath: string,
  versionId: string,
): Promise<void> {
  // 1. upload raw video to R2
  const videoUrl = await uploadFileToR2(localVideoPath, "videos");
  await prisma.docVersion.update({
    where: { id: versionId },
    data: { sourceVideoUrl: videoUrl },
  });

  // 2. extract keyframes locally via ffmpeg
  const framePaths = await extractKeyFrames(localVideoPath);

  // 3. ask Claude to structure frames into steps
  const structuredSteps = await structureStepsFromFrames(framePaths);

  // 4. upload only the frames selected as steps, to R2
  const stepsWithUrls: StepWithScreenshot[] = [];
  for (const step of structuredSteps) {
    const framePath = framePaths[step.frame_index];
    const screenshotUrl = await uploadFileToR2(framePath, "screenshots");
    stepsWithUrls.push({ ...step, screenshotUrl });
  }

  // 5. persist steps
  await prisma.$transaction(
    stepsWithUrls.map((step, i) =>
      prisma.step.create({
        data: {
          docVersionId: versionId,
          orderIndex: i,
          title: step.title,
          bodyText: step.body_text,
          screenshotUrl: step.screenshotUrl,
        },
      }),
    ),
  );

  await prisma.docVersion.update({
    where: { id: versionId },
    data: { status: "ready" },
  });

  // 6. cleanup local temp files
  fs.unlinkSync(localVideoPath);
  framePaths.forEach((p) => {
    try {
      fs.unlinkSync(p);
    } catch {
      /* already removed, ignore */
    }
  });
}

export default router;
