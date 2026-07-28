"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { fetchDiff } from "@/lib/api";
import type { DiffResult, StepDiffEntry } from "@/lib/types";

const badgeStyles: Record<StepDiffEntry["type"], string> = {
  unchanged: "bg-neutral-100 text-neutral-500",
  modified: "bg-amber-100 text-amber-700",
  added: "bg-green-100 text-green-700",
  removed: "bg-red-100 text-red-700",
};

export default function DiffView({
  documentId,
  versionId,
}: {
  documentId: string;
  versionId: string;
}) {
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDiff(documentId, versionId)
      .then(setDiff)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load diff"),
      );
  }, [documentId, versionId]);

  if (error) return <p className="text-sm text-red-600 px-6 py-8">{error}</p>;
  if (!diff)
    return (
      <p className="text-sm text-neutral-500 px-6 py-8">Loading diff...</p>
    );

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-4">
      {diff.stepDiffs.map((entry, i) => (
        <div
          key={i}
          className="border border-neutral-200 rounded-xl overflow-hidden bg-white"
        >
          <div className="px-5 py-2.5 border-b border-neutral-100 flex items-center gap-2">
            <span
              className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${badgeStyles[entry.type]}`}
            >
              {entry.type}
            </span>
            <h3 className="text-sm font-semibold text-neutral-900">
              {entry.newStep?.title ?? entry.oldStep?.title}
            </h3>
          </div>

          {entry.type === "modified" && entry.oldStep && entry.newStep && (
            <div className="grid grid-cols-2 gap-px bg-neutral-200">
              <div className="relative aspect-video bg-neutral-100">
                <Image
                  src={entry.oldStep.screenshotUrl}
                  alt="before"
                  fill
                  className="object-contain opacity-70"
                />
                <span className="absolute top-2 left-2 text-[10px] bg-white/90 px-1.5 py-0.5 rounded">
                  before
                </span>
              </div>
              <div className="relative aspect-video bg-neutral-100">
                <Image
                  src={entry.newStep.screenshotUrl}
                  alt="after"
                  fill
                  className="object-contain"
                />
                <span className="absolute top-2 left-2 text-[10px] bg-white/90 px-1.5 py-0.5 rounded">
                  after
                </span>
              </div>
            </div>
          )}

          {entry.type !== "modified" &&
            (entry.newStep ?? entry.oldStep)?.screenshotUrl && (
              <div className="relative aspect-video bg-neutral-100">
                <Image
                  src={(entry.newStep ?? entry.oldStep)!.screenshotUrl}
                  alt="step"
                  fill
                  className={`object-contain ${entry.type === "removed" ? "opacity-50" : ""}`}
                />
              </div>
            )}

          <p className="px-5 py-3 text-sm text-neutral-600">
            {entry.newStep?.bodyText ?? entry.oldStep?.bodyText}
          </p>
        </div>
      ))}
    </div>
  );
}
