"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { uploadVideo } from "@/lib/api";

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }

  async function handleSubmit() {
    if (!file) return;
    setIsUploading(true);
    setError(null);

    try {
      const result = await uploadVideo(file, title || file.name);
      router.push(`/document/${result.documentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setIsUploading(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50 flex items-center justify-center px-4">
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-semibold text-neutral-900 mb-1">
          Generate a doc from a screen recording
        </h1>
        <p className="text-neutral-500 mb-8">
          Upload a rough, unedited video. We&apos;ll turn it into a structured,
          step-by-step guide with screenshots.
        </p>

        <input
          type="text"
          placeholder="Document title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full mb-4 px-4 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
            isDragging
              ? "border-neutral-900 bg-neutral-100"
              : "border-neutral-300"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <p className="text-sm text-neutral-800 font-medium">{file.name}</p>
          ) : (
            <p className="text-sm text-neutral-500">
              Drag a video here, or click to browse
            </p>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={!file || isUploading}
          className="mt-6 w-full py-2.5 rounded-lg bg-neutral-900 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isUploading ? "Uploading..." : "Generate document"}
        </button>
      </div>
    </main>
  );
}
