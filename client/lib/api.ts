const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

import type {
  Document,
  DocumentSummary,
  UploadResponse,
  DiffResult,
} from "./types";

export async function listDocuments(): Promise<DocumentSummary[]> {
  const res = await fetch(`${API_BASE}/api/v1/documents`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to list documents: ${res.status}`);
  return res.json();
}

export async function fetchDocument(documentId: string): Promise<Document> {
  const res = await fetch(`${API_BASE}/api/v1/documents/${documentId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to fetch document: ${res.status}`);
  return res.json();
}

export async function createDocument(
  file: File,
  title: string,
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("video", file);
  formData.append("title", title);

  const res = await fetch(`${API_BASE}/api/v1/documents`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

// separate endpoint from createDocument — this appends a new version to an EXISTING document
export async function regenerateDocument(
  documentId: string,
  file: File,
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("video", file);

  const res = await fetch(
    `${API_BASE}/api/v1/documents/${documentId}/versions`,
    {
      method: "POST",
      body: formData,
    },
  );
  if (!res.ok) throw new Error(`Regenerate failed: ${res.status}`);
  return res.json();
}

export async function fetchDiff(
  documentId: string,
  versionId: string,
): Promise<DiffResult> {
  const res = await fetch(
    `${API_BASE}/api/v1/documents/${documentId}/versions/${versionId}/diff`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Failed to fetch diff: ${res.status}`);
  return res.json();
}

// lib/api.ts
export async function deleteVersion(
  documentId: string,
  versionId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/v1/documents/${documentId}/versions/${versionId}`,
    {
      method: "DELETE",
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Delete failed: ${res.status}`);
  }
}
