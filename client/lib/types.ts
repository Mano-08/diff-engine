export type DocVersionStatus = "processing" | "ready" | "failed";

export interface Step {
  id: string;
  orderIndex: number;
  title: string;
  bodyText: string;
  screenshotUrl: string;
}

export interface DocVersion {
  id: string;
  versionNumber: number;
  status: DocVersionStatus;
  sourceVideoUrl: string | null;
  errorMessage: string | null;
  steps: Step[];
}

export interface Document {
  id: string;
  title: string;
  createdAt: string;
  versions: DocVersion[];
}

export interface UploadResponse {
  documentId: string;
  versionId: string;
  status: DocVersionStatus;
}
