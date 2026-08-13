// src/pipeline/jobDir.ts

import { promises as fs } from "fs";
import path from "path";

const TMP_ROOT = path.join(process.cwd(), "tmp");

export function jobDirPath(jobId: string): string {
  return path.join(TMP_ROOT, jobId);
}

export async function createJobDir(jobId: string): Promise<string> {
  const dir = jobDirPath(jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanupJobDir(jobId: string): Promise<void> {
  const dir = jobDirPath(jobId);
  await fs.rm(dir, { recursive: true, force: true }).catch((err) => {
    console.error(`Failed to clean up job dir ${dir}:`, err);
  });
}

/**
 * Runs `fn` with a freshly created tmp/{jobId} directory and guarantees
 * the directory is deleted immediately afterwards, success or failure.
 */
export async function withJobDir<T>(
  jobId: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await createJobDir(jobId);
  try {
    return await fn(dir);
  } finally {
    await cleanupJobDir(jobId);
  }
}
