"use client";

import { useParams, useRouter } from "next/navigation";
import { regenerateDocument } from "@/lib/api";
import VideoUploadForm from "@/components/VideoUploadForm";

export default function RegenerateDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  async function handleSubmit(file: File) {
    await regenerateDocument(id, file);
    // land back on the doc hub — the new version will show up as "processing"
    // in the version tabs once the GET call picks it up
    router.push(`/document/${id}`);
  }

  return (
    <main className="h-full flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-xl">
        <h1 className="text-xl font-semibold text-neutral-900 mb-1">
          Regenerate document
        </h1>
        <p className="text-sm text-neutral-500 mb-8">
          Upload an updated recording. We&apos;ll generate a new version and
          show you what changed.
        </p>
        <VideoUploadForm
          submitLabel="Regenerate document"
          onSubmit={handleSubmit}
        />
      </div>
    </main>
  );
}
