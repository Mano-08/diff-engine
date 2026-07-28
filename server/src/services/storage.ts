import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

// import { uploadFileToR2 } from './storageR2.js'; // <-- swap back in later for R2

const STORAGE_DIR = path.resolve("storage"); // served statically from server.ts
const PUBLIC_URL_BASE =
  process.env.PUBLIC_URL_BASE || "http://localhost:4000/files";

export async function uploadFileToR2(
  localFilePath: string,
  keyPrefix: string,
): Promise<string> {
  // Keeping the function name the same as the R2 version so routes/documents.ts
  // doesn't need to change when we swap storage backends later.
  const ext = path.extname(localFilePath);
  const destDir = path.join(STORAGE_DIR, keyPrefix);
  fs.mkdirSync(destDir, { recursive: true });

  const filename = `${nanoid()}${ext}`;
  const destPath = path.join(destDir, filename);

  fs.copyFileSync(localFilePath, destPath);

  return `${PUBLIC_URL_BASE}/${keyPrefix}/${filename}`;
}
