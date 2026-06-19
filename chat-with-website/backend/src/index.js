import "dotenv/config";
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { crawlSite } from "./crawler.js";
import { chunkPages } from "./chunker.js";
import { VectorStore } from "./vectorStore.js";
import { RAGChat, MIN_RELEVANCE_SCORE } from "./rag.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
app.use(express.json());

const vectorStore = new VectorStore();
const ragChat = new RAGChat();

// In-memory session store: siteId → { url, status, pageCount, chunkCount, error }
const sessions = new Map();

// ─── Health check ────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ ok: true }));

// ─── POST /api/crawl ─────────────────────────────────────────────────────────
// Start crawling a URL. Returns a siteId immediately; client polls /status.
app.post("/api/crawl", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const siteId = uuidv4();
  sessions.set(siteId, {
    url: parsedUrl.href,
    status: "crawling",
    pageCount: 0,
    chunkCount: 0,
    progress: { crawled: 0, queued: 0, currentUrl: "" },
    error: null,
  });

  res.json({ siteId, url: parsedUrl.href });

  // Run crawl + index asynchronously
  (async () => {
    const session = sessions.get(siteId);
    try {
      // Step 1: Crawl
      const pages = await crawlSite(parsedUrl.href, {
        onProgress: (crawled, queued, currentUrl) => {
          session.progress = { crawled, queued, currentUrl };
        },
      });

      if (pages.length === 0) {
        session.status = "error";
        session.error = "No pages could be crawled from this URL.";
        return;
      }

      session.status = "indexing";
      session.pageCount = pages.length;

      // Step 2: Chunk
      const chunks = chunkPages(pages);
      session.chunkCount = chunks.length;

      // Step 3: Embed + index
      await vectorStore.indexSite(siteId, chunks);

      session.status = "ready";
    } catch (err) {
      console.error(`[server] Crawl/index failed for ${siteId}:`, err.message);
      session.status = "error";
      session.error = err.message;
    }
  })();
});

// ─── GET /api/status/:siteId ──────────────────────────────────────────────────
app.get("/api/status/:siteId", (req, res) => {
  const session = sessions.get(req.params.siteId);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

// ─── POST /api/chat ───────────────────────────────────────────────────────────
// Streaming SSE endpoint. Client sends: { siteId, query, history }
app.post("/api/chat", async (req, res) => {
  const { siteId, query, history = [] } = req.body;

  if (!siteId || !query) {
    return res.status(400).json({ error: "siteId and query are required" });
  }

  const session = sessions.get(siteId);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.status !== "ready") {
    return res.status(409).json({ error: `Site is not ready (status: ${session.status})` });
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Retrieve relevant chunks
    const chunks = await vectorStore.search(siteId, query);

    // Only surface sources that clear the same relevance bar the model uses —
    // otherwise we'd show citation pills for chunks the model wasn't actually grounded on.
    const groundedChunks = chunks.filter((c) => c.score >= MIN_RELEVANCE_SCORE);
    const sources = deduplicateSources(groundedChunks);
    send("sources", { sources });

    // Stream the answer
    await ragChat.chat(session.url, query, chunks, history, (delta) => {
      send("delta", { text: delta });
    });

    send("done", {});
  } catch (err) {
    console.error("[server] Chat error:", err.message);
    send("error", { message: err.message });
  } finally {
    res.end();
  }
});

// ─── DELETE /api/session/:siteId ─────────────────────────────────────────────
app.delete("/api/session/:siteId", (req, res) => {
  const { siteId } = req.params;
  vectorStore.deleteSite(siteId);
  sessions.delete(siteId);
  res.json({ ok: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function deduplicateSources(chunks) {
  const seen = new Set();

  return chunks
    .filter((c) => {
      if (seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    })
    .map((c) => ({
      url: c.url,
      title: c.title,
      score: c.score,
    }));
}

// ─── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`);

  if (!process.env.GEMINI_API_KEY) {
    console.warn("[server] WARNING: GEMINI_API_KEY not set!");
  }
});

// ─── RAG system prompt builder ───────────────────────────────────────────────
