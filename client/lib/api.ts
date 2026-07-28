const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

import type { Document, UploadResponse } from "./types";

export async function uploadVideo(
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

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Upload failed with status ${res.status}`);
  }

  return res.json();
}

export async function fetchDocument(documentId: string): Promise<Document> {
  const res = await fetch(`${API_BASE}/api/v1/documents/${documentId}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch document: ${res.status}`);
  }

  return res.json();
}
