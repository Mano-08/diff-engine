// src/services/embeddings.ts

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 100; // OpenAI accepts many inputs per call; batch defensively

/**
 * Embeds a list of texts (one per Step) for storage in Step.embedding (Json).
 * Preserves input order — embeddings[i] corresponds to texts[i].
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });

    // OpenAI returns embeddings in the same order as the input batch
    response.data.forEach((item, batchIndex) => {
      results[i + batchIndex] = item.embedding;
    });
  }

  return results;
}
