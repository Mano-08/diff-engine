import Image from "next/image";
import type { DocVersion } from "@/lib/types";

export default function DocumentVersionView({
  version,
}: {
  version: DocVersion;
}) {
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
    <div className="max-w-2xl mx-auto px-6 py-8">
      {version.sourceVideoUrl && (
        <video
          src={version.sourceVideoUrl}
          controls
          className="w-full rounded-lg mb-8 bg-black"
        />
      )}

      <div className="space-y-6">
        {version.steps.map((step) => (
          <div
            key={step.id}
            className="border border-neutral-200 rounded-xl overflow-hidden bg-white"
          >
            <div className="px-5 py-3 border-b border-neutral-100 flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-medium">
                {step.orderIndex + 1}
              </span>
              <h3 className="text-sm font-semibold text-neutral-900">
                {step.title}
              </h3>
            </div>
            <div className="relative w-full aspect-video bg-neutral-100">
              <Image
                src={step.screenshotUrl}
                alt={step.title}
                fill
                className="object-contain"
              />
            </div>
            <p className="px-5 py-3 text-sm text-neutral-600">
              {step.bodyText}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
