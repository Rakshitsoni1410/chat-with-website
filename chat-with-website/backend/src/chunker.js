/**
 * Text chunking strategy:
 * - Split on paragraph/sentence boundaries, not arbitrary character positions
 * - Target ~400 tokens (~1600 chars) per chunk with 80-char overlap
 * - Preserve source URL and title in each chunk for citation
 *
 * Why these numbers?
 * - 400 tokens fits comfortably in embedding context (most models: 512 or 8192)
 * - Overlap ensures a sentence split between chunks doesn't lose context
 * - Paragraph-aware splitting keeps semantic units together
 */

const CHUNK_SIZE = 1600; // ~400 tokens
const CHUNK_OVERLAP = 200; // character overlap between chunks

/**
 * Split text into overlapping chunks, respecting paragraph boundaries.
 */
function splitTextIntoChunks(text) {
  // Split on double newlines (paragraphs) first, then sentences
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 <= CHUNK_SIZE) {
      current = current ? current + "\n\n" + para : para;
    } else {
      if (current.length > 0) {
        chunks.push(current);
        // Overlap: keep the tail of previous chunk
        const overlap = current.slice(-CHUNK_OVERLAP);
        current = overlap + "\n\n" + para;
      } else {
        // Single paragraph larger than chunk size — split by sentence
        const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
        for (const sentence of sentences) {
          if (current.length + sentence.length + 1 <= CHUNK_SIZE) {
            current = current ? current + " " + sentence : sentence;
          } else {
            if (current.length > 0) chunks.push(current);
            current = sentence;
          }
        }
      }
    }
  }

  if (current.trim().length > 50) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Given an array of crawled pages, return flat array of chunk objects.
 * Each chunk: { id, url, title, text, chunkIndex }
 */
export function chunkPages(pages) {
  const chunks = [];
  let globalId = 0;

  for (const page of pages) {
    const textChunks = splitTextIntoChunks(page.text);
    textChunks.forEach((text, idx) => {
      chunks.push({
        id: globalId++,
        url: page.url,
        title: page.title,
        text,
        chunkIndex: idx,
      });
    });
  }

  console.log(`[chunker] ${pages.length} pages → ${chunks.length} chunks`);
  return chunks;
}
