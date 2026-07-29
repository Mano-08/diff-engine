// lib/tiptap/stepsToInitialDoc.ts
import type { JSONContent } from "@tiptap/core";
import type { Step } from "@/lib/types";

export function stepsToInitialDoc(steps: Step[]): JSONContent {
  const content: JSONContent[] = [];

  steps.forEach((step, i) => {
    content.push({
      type: "heading",
      attrs: { level: 1 },
      content: i === 0 ? [{ type: "text", text: step.title }] : undefined,
    });
    if (i > 0) {
      // subsequent steps become bolded lead-in text rather than more h1s,
      // since the schema only really supports one true title —
      // simplest honest choice given the "one heading" constraint
      content.push({
        type: "paragraph",
        content: [
          { type: "text", marks: [{ type: "bold" }], text: step.title },
        ],
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
