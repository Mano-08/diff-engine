"use client";

import type { Editor } from "@tiptap/react";
import { Bold, Italic } from "lucide-react";

export default function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-neutral-200">
      <div className="max-w-2xl mx-auto px-4 py-2 flex items-center gap-1">
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
    </div>
  );
}
