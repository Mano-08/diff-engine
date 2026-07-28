"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchDocument } from "@/lib/api";
import type { Document } from "@/lib/types";

const POLL_INTERVAL_MS = 2500;

export function useDocument(documentId: string) {
  const [document, setDocument] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const doc = await fetchDocument(documentId);
      setDocument(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load document");
    }
  }, [documentId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const hasProcessingVersion = document?.versions.some(
      (v) => v.status === "processing",
    );
    if (!hasProcessingVersion) return;

    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [document, refresh]);

  return { document, error, refresh };
}
