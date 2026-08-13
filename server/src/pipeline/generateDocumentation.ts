// src/pipeline/generateDocumentation.ts

import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { FinalStep, SelectedScreenshot } from "./types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function toCompressedBase64(framePath: string): Promise<string> {
  const buf = await sharp(framePath)
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return buf.toString("base64");
}

const RESPONSE_SCHEMA_HINT = `
Respond ONLY with JSON matching this shape, nothing else:
{
  "documentTitle": string,
  "steps": [
    { "orderIndex": number, "title": string, "bodyText": string, "imageIndex": number }
  ]
}
imageIndex must match the 0-based order the images were given to you in.
`;

/**
 * Stage 6: the ONLY call in the whole pipeline that sends images to Claude.
 * Takes the already-curated, deduped, budget-trimmed screenshots.
 */
export async function generateDocumentation(
  screenshots: SelectedScreenshot[],
  documentTitle: string,
): Promise<{ documentTitle: string; steps: FinalStep[] }> {
  const ordered = [...screenshots].sort(
    (a, b) => a.candidate.timestampSec - b.candidate.timestampSec,
  );

  const content: any[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    const base64 = await toCompressedBase64(s.framePath);
    content.push({
      type: "text",
      text:
        `Image ${i} - timestamp ${s.candidate.timestampSec.toFixed(1)}s.` +
        (s.candidate.transcriptSnippet
          ? ` Narration around this moment: "${s.candidate.transcriptSnippet}"`
          : " (no narration available)"),
    });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: base64 },
    });
  }
  content.push({ type: "text", text: RESPONSE_SCHEMA_HINT });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system:
      "You write clear, step-numbered software documentation from a curated set of " +
      "screenshots and their surrounding narration. Only document what the evidence " +
      "shows - never invent steps, buttons, or menus that aren't visible or mentioned. " +
      'Each step\'s bodyText should be 1-3 sentences, imperative mood ("Click X", "Enter Y").',
    messages: [{ role: "user", content }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const parsed = JSON.parse((textBlock as any)?.text ?? "{}") as {
    documentTitle: string;
    steps: Array<{
      orderIndex: number;
      title: string;
      bodyText: string;
      imageIndex: number;
    }>;
  };

  const steps: FinalStep[] = parsed.steps.map((s) => ({
    orderIndex: s.orderIndex,
    title: s.title,
    bodyText: s.bodyText,
    screenshotLocalPath: ordered[s.imageIndex].framePath,
    timestampSec: ordered[s.imageIndex].candidate.timestampSec,
  }));

  return { documentTitle: parsed.documentTitle || documentTitle, steps };
}

/** Assembles the final .md from steps + already-uploaded cloud image URLs. */
export function assembleMarkdown(
  documentTitle: string,
  steps: Array<FinalStep & { screenshotUrl: string }>,
): string {
  const lines: string[] = [`# ${documentTitle}`, ""];
  for (const step of steps.sort((a, b) => a.orderIndex - b.orderIndex)) {
    lines.push(`## ${step.orderIndex}. ${step.title}`, "");
    lines.push(step.bodyText, "");
    lines.push(`![${step.title}](${step.screenshotUrl})`, "");
  }
  return lines.join("\n");
}
