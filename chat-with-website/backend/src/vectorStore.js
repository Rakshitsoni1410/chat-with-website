import { GoogleGenAI } from "@google/genai";

/**
 * In-memory vector store using Gemini embeddings + cosine similarity.
 *
 * Design decision:
 * - In-memory store is enough for ~250 chunks.
 * - No external vector DB required.
 * - Easily replaceable with Pinecone or pgvector later.
 */

const EMBEDDING_MODEL = "text-embedding-004";
const TOP_K = 5;

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class VectorStore {
  constructor() {
    this.ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    // Map of siteId → { chunks, embeddings }
    this.sites = new Map();
  }

  /**
   * Embed a batch of texts.
   */
  async embedTexts(texts) {
    const allEmbeddings = [];

    for (const text of texts) {
     const response = await this.ai.models.embedContent({
  model: "text-embedding-004",
  contents: text,
});

allEmbeddings.push(response.embedding.values);
    }

    return allEmbeddings;
  }

  /**
   * Index all chunks for a site.
   */
  async indexSite(siteId, chunks) {
    console.log(
      `[vectorStore] Embedding ${chunks.length} chunks for site ${siteId}...`
    );

    const texts = chunks.map(
      (chunk) => `${chunk.title}\n\n${chunk.text}`
    );

    const embeddings = await this.embedTexts(texts);

    this.sites.set(siteId, {
      chunks,
      embeddings,
    });

    console.log(`[vectorStore] Indexed ${chunks.length} chunks`);

    return chunks.length;
  }

  /**
   * Search for the most relevant chunks.
   */
  async search(siteId, query, topK = TOP_K) {
    const site = this.sites.get(siteId);

    if (!site) {
      throw new Error(`Site ${siteId} not indexed`);
    }

    const [queryEmbedding] = await this.embedTexts([query]);

    const scored = site.chunks.map((chunk, i) => ({
      chunk,
      score: cosineSimilarity(
        queryEmbedding,
        site.embeddings[i]
      ),
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored
      .slice(0, topK)
      .map(({ chunk, score }) => ({
        ...chunk,
        score,
      }));
  }

  hasSite(siteId) {
    return this.sites.has(siteId);
  }

  deleteSite(siteId) {
    this.sites.delete(siteId);
  }

  getSiteInfo(siteId) {
    const site = this.sites.get(siteId);

    if (!site) return null;

    const uniqueUrls = new Set(
      site.chunks.map((chunk) => chunk.url)
    );

    return {
      chunkCount: site.chunks.length,
      pageCount: uniqueUrls.size,
    };
  }
}