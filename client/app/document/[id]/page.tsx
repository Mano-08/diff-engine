"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { fetchDocument } from "@/lib/api";
import type { Document } from "@/lib/types";
import StepCard from "@/components/StepCard";

const POLL_INTERVAL_MS = 2500;

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const [document, setDocument] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const doc = await fetchDocument(id);
      setDocument(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load document");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const latestVersion = document?.versions[0];
    if (!latestVersion || latestVersion.status !== "processing") return;

    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [document, load]);

  if (error) {
    return <CenteredMessage text={error} isError />;
  }

  if (!document) {
    return <CenteredMessage text="Loading..." />;
  }

  const version = document.versions[0];

  if (!version || version.status === "processing") {
    return (
      <CenteredMessage text="Generating your document — extracting steps from the recording..." />
    );
  }

  if (version.status === "failed") {
    return (
      <CenteredMessage
        text={`Generation failed: ${version.errorMessage ?? "unknown error"}`}
        isError
      />
    );
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold text-neutral-900 mb-1">
          {document.title}
        </h1>
        <p className="text-sm text-neutral-500 mb-8">
          {version.steps.length} steps generated from your recording
        </p>

        <div className="space-y-6">
          {version.steps.map((step) => (
            <StepCard key={step.id} step={step} />
          ))}
        </div>
      </div>
    </main>
  );
}

function CenteredMessage({
  text,
  isError = false,
}: {
  text: string;
  isError?: boolean;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <p className={`text-sm ${isError ? "text-red-600" : "text-neutral-500"}`}>
        {text}
      </p>
    </main>
  );
}
