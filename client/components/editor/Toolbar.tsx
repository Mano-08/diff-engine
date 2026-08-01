"use client";

import type { Editor } from "@tiptap/react";
import { Bold, Italic, Download } from "lucide-react";
import { jsonToMarkdown } from "@/lib/tiptap/jsonToMarkdown";
import { downloadMarkdown } from "@/lib/downloadMarkdown";

export default function Toolbar({
  editor,
  documentTitle,
}: {
  editor: Editor;
  documentTitle: string;
}) {
  function handleDownload() {
    const markdown = jsonToMarkdown(editor.getJSON());
    downloadMarkdown(markdown, documentTitle);
  }

  return (
    <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-neutral-200">
      <div className="max-w-2xl mx-auto px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded transition-colors ${
              editor.isActive("bold")
                ? "bg-neutral-900 text-white"
                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            }`}
          >
            <Bold size={15} />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded transition-colors ${
              editor.isActive("italic")
                ? "bg-neutral-900 text-white"
                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            }`}
          >
            <Italic size={15} />
          </button>
        </div>

        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
        >
          <Download size={14} />
          Export .md
        </button>
      </div>
    </div>
  );
}
