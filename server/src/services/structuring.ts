import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import type { StructuredStep } from "../types.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are given a sequence of screenshots taken from a screen recording, in chronological order, each labeled with its frame index. Group them into logical steps a user would take to complete the task shown. Merge frames that belong to the same action; skip frames that show nothing meaningful (transitions, blank loading screens).

Return ONLY strict JSON, no prose, no markdown fences, in this shape:
[
  { "title": "short step title", "body_text": "1-2 sentence instruction", "frame_index": 0 }
]`;

type ImageContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: "image/png"; data: string };
    };

export async function structureStepsFromFrames(
  localFramePaths: string[],
): Promise<StructuredStep[]> {
  const imageBlocks: ImageContentBlock[] = localFramePaths.flatMap(
    (filePath, index) => [
      { type: "text", text: `Frame index ${index}:` },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: fs.readFileSync(filePath).toString("base64"),
        },
      },
    ],
  );

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
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
