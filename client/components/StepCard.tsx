import Image from "next/image";
import type { Step } from "@/lib/types";

export default function StepCard({ step }: { step: Step }) {
  return (
    <div className="border border-neutral-200 rounded-xl overflow-hidden bg-white">
      <div className="px-5 py-3 border-b border-neutral-100 flex items-center gap-2">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-medium">
          {step.orderIndex + 1}
        </span>
        <h3 className="text-sm font-semibold text-neutral-900">{step.title}</h3>
      </div>

      <div className="relative w-full aspect-video bg-neutral-100">
        <Image
          src={step.screenshotUrl}
          alt={step.title}
          fill
          className="object-contain"
        />
      </div>

      <p className="px-5 py-3 text-sm text-neutral-600">{step.bodyText}</p>
    </div>
  );
}
