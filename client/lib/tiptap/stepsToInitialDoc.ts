// lib/tiptap/stepsToInitialDoc.ts
import type { JSONContent } from "@tiptap/core";
import type { Step } from "@/lib/types";

export function stepsToInitialDoc(steps: Step[]): JSONContent {
  const content: JSONContent[] = [];

  steps.forEach((step, i) => {
    if (i === 0) {
      // only the very first step's title becomes the document's actual h1
      content.push({
        type: "heading",
        attrs: { level: 1 },
        content: step.title ? [{ type: "text", text: step.title }] : undefined,
      });
    } else {
      // subsequent steps: title becomes bold lead-in text, NOT a heading node
      content.push({
        type: "paragraph",
        content: step.title
          ? [{ type: "text", marks: [{ type: "bold" }], text: step.title }]
          : undefined,
      });
    }

    if (step.screenshotUrl) {
      content.push({ type: "image", attrs: { src: step.screenshotUrl } });
    }

    content.push({
      type: "paragraph",
      content: step.bodyText
        ? [{ type: "text", text: step.bodyText }]
        : undefined,
    });
  });

  return {
    type: "doc",
    content: content.length
      ? content
      : [{ type: "heading", attrs: { level: 1 } }],
  };
}
