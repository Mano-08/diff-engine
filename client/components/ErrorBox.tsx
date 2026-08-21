import "react";

export default function ErrorBox({ error }: { error: string }) {
  // Remove /s flag for compatibility with pre-ES2018
  // Instead, match newlines with [\s\S] for "dotall" behavior
  const match = error.match(/^.*?:\s*(\d+)\s+(\{[\s\S]*\})\s*$/);

  let code: string | null = null;
  let message: string | null = null;

  if (match) {
    code = match[1];

    try {
      const parsed = JSON.parse(match[2]);
      message = parsed?.error?.message ?? parsed?.message ?? null;
    } catch {
      // JSON couldn't be parsed
    }
  }

  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="rounded-xl border min-w-[350px] border-solid max-w-88 mx-auto border-neutral-200 bg-white p-4 text-sm text-black">
        <p className="font-semibold text-red-600">Error</p>

        {code && (
          <p className="mt-3">
            <span className="font-semibold">Error code:</span> {code}
          </p>
        )}
        {message && (
          <p className="mt-1">
            <span className="font-semibold">Message:</span> {message}
          </p>
        )}
        {!code && !message && (
          <p className="mt-3 whitespace-pre-wrap">{error}</p>
        )}
      </div>
    </div>
  );
}
