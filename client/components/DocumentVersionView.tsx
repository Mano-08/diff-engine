// components/DocumentVersionView.tsx
import NotionEditor from "@/components/editor/NotionEditor";
import { saveDocumentContent } from "@/lib/api";
import { stepsToInitialDoc } from "@/lib/tiptap/stepsToInitialDoc";
import type { DocVersion } from "@/lib/types";
import { debounce } from "lodash";
import { useMemo } from "react";

export default function DocumentVersionView({
  version,
  documentId,
}: {
  version: DocVersion;
  documentId: string;
}) {
  const debouncedSave = useMemo(
    () =>
      debounce((json: object) => {
        saveDocumentContent(documentId, version.id, json).catch(console.error);
      }, 1000),
    [documentId, version.id],
  );

  if (version.status === "processing") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-neutral-500">
          Generating this version — extracting steps from the recording...
        </p>
      </div>
    );
  }

  if (version.status === "failed") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-red-600">
          Generation failed: {version.errorMessage ?? "unknown error"}
        </p>
      </div>
    );
  }

  return (
    <div>
      {version.sourceVideoUrl && (
        <div className="max-w-2xl mx-auto px-4 pt-8">
          <video
            src={version.sourceVideoUrl}
            controls
            className="w-full rounded-lg bg-black"
          />
        </div>
      )}

      <NotionEditor
        initialContent={version.contentJson ?? stepsToInitialDoc(version.steps)}
        onChange={debouncedSave}
      />
    </div>
  );
}
