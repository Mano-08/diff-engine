export interface StructuredStep {
  title: string;
  body_text: string;
  frame_index: number;
}

export interface StepWithScreenshot extends StructuredStep {
  screenshotUrl: string;
}

export type DocVersionStatus = "processing" | "ready" | "failed";
