# Chat with a Website

Give it a URL, it crawls the site, and lets you ask questions about it with answers grounded in the actual pages — every answer links back to the source.

## Stack

- **Frontend:** React (Vite), no framework beyond React itself — plain CSS, no UI library.
- **Backend:** Node.js + Express.
- **Vector store:** in-memory cosine similarity (see "Why in-memory" below).
- **LLM:** OpenAI (`gpt-4o-mini` for chat, `text-embedding-3-small` for embeddings).

## Running it

You need an OpenAI API key (used for embeddings + chat completions).

### Backend

```bash
cd backend
npm install
cp .env.example .env
# edit .env and set OPENAI_API_KEY=sk-...
npm run dev
```

Runs on `http://localhost:3001`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # only needed if backend isn't on localhost:3001
npm run dev
```

Runs on `http://localhost:5173`.

Open the frontend, paste a URL (e.g. a docs site, a small marketing site, a blog), wait for the crawl + index to finish, then ask questions.

### Required env vars

| Var | Where | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | backend/.env | embeddings + chat completions |
| `PORT` | backend/.env | backend port (default 3001) |
| `FRONTEND_URL` | backend/.env | CORS origin (default `http://localhost:5173`) |
| `VITE_API_URL` | frontend/.env | backend URL the frontend calls (default `http://localhost:3001`) |

---

## How it works

### 1. Crawling (`backend/src/crawler.js`)

- **Scope:** same-origin only. Every discovered link is resolved against the page's URL and compared by `origin` (protocol + host + port) before it's queued. Anything off-domain is dropped immediately — the crawler never leaves the site.
- **Limits:** hard caps of **50 pages** and **depth 4** from the start URL (both are constants at the top of the file, easy to tune). This is a deliberate "don't wander off" guardrail, not a performance optimization.
- **Politeness:**
  - `robots.txt` is fetched once at the start and checked via `robots-parser` before every single fetch. Disallowed URLs are skipped and logged, not silently ignored.
  - A 500ms delay is enforced between requests (`REQUEST_DELAY_MS`), so even a 50-page crawl takes ~25 seconds minimum — that's intentional.
  - A descriptive `User-Agent` is sent (`ChatWithWebsiteBot/1.0 ...`) so site owners can identify and block the bot if they want to.
- **Boilerplate stripping:** before extracting text, `<nav>`, `<footer>`, `<header>`, `<script>`, `<style>`, common cookie-banner classes, and ARIA `navigation`/`banner` roles are removed from the DOM. Then the extractor prefers `<main>`, `<article>`, or common content containers over `<body>` if one exists — this avoids polluting the index with "Home / About / Contact / © 2026" on every single page.
- **What it doesn't do:** no JavaScript rendering (no headless browser). It fetches raw HTML via `axios` and parses with `cheerio`. Sites that render their main content client-side (heavy SPA, no SSR) will index poorly or come back empty. This is the single biggest limitation — see "What I'd improve."

### 2. Chunking (`backend/src/chunker.js`)

- Splits cleaned page text into chunks of **~1600 characters (~400 tokens)**, preferring paragraph boundaries (`\n\n`) over arbitrary cuts, falling back to sentence boundaries for any single paragraph that's too long.
- **200-character overlap** between consecutive chunks, so a sentence or idea that spans a chunk boundary doesn't lose context for retrieval.
- Each chunk keeps the source `url` and `title` — this is what makes citations possible later.
- This is a heuristic chunker, not a semantic one — it doesn't try to detect topic shifts. See "What I'd improve."

### 3. Retrieval (`backend/src/vectorStore.js`)

- Each chunk (title + text, concatenated) is embedded with `text-embedding-3-small`.
- Embeddings live in a plain in-memory array. A query is embedded once, then compared to every chunk via cosine similarity, sorted, and the **top 5** are returned.

**Why in-memory instead of pgvector / Pinecone / Chroma?**
A typical crawl here produces a few hundred chunks at most (50 pages × ~5 chunks/page). Brute-force cosine similarity over a few hundred vectors is sub-5ms — there's no retrieval-quality or latency reason to reach for a real vector DB at this scale. The trade-off is explicit: the index is lost on server restart, and this wouldn't scale to thousands of pages or multiple concurrent large sites. For that, swap `VectorStore` for pgvector behind the same `indexSite`/`search` interface — the rest of the app doesn't care how retrieval is implemented.

### 4. Grounded answers (`backend/src/rag.js`)

- The top 5 retrieved chunks are filtered by a minimum relevance score (`0.3` cosine similarity). If nothing clears that bar, the app **never calls the LLM** — it returns "I couldn't find information about that on this website" directly. This is the main anti-hallucination guardrail: weak retrieval short-circuits before the model ever gets a chance to improvise.
- If there are relevant chunks, they're injected into the system prompt as labeled `[Source N]` blocks with their URL and title, and the model is explicitly instructed to:
  - only use the provided context, not outside knowledge,
  - say it doesn't know rather than guess, if the context is insufficient,
  - always cite the specific pages it used, in a fixed format.
- Temperature is set low (`0.2`) to keep answers close to the source text rather than creative.
- Responses stream token-by-token over Server-Sent Events. The frontend renders the citation pills as soon as the `sources` event arrives (before the answer finishes streaming), then streams in the answer text.

### 5. Citations (frontend)

Sources come back as structured data (`{ url, title, score }`) alongside the text — they are **not parsed out of the model's prose**. The backend filters retrieved chunks by the same relevance threshold (`MIN_RELEVANCE_SCORE`, 0.3) before sending them as citation pills *and* before handing them to the model, so the pills the user sees always match exactly what the model was actually grounded on — there's no path where a low-relevance chunk shows up as a "source" for an answer that didn't really use it. The model is also asked to mention sources in its own prose for transparency, but the UI's citation pills are rendered from the retrieval result directly, so a citation can never be missing or fabricated by the model.

---

## What works

- Same-domain crawl with robots.txt + rate limiting, verified against a local mock site and unit-style tests of the extraction/chunking/robots logic (sandbox network restrictions blocked me from hitting a live public site during this build — see note in commit history / ask me in the walkthrough and I'll crawl a real site live).
- Boilerplate stripping measurably removes nav/footer/cookie text — confirmed by feeding raw HTML through the extractor and diffing output.
- Chunking produces correctly-sized, overlapping chunks (verified with a chunking test against synthetic long text).
- Retrieval math (cosine similarity) is correct (identical vectors → 1.0, orthogonal → 0.0, opposite → -1.0).
- The "don't know" fallback fires before any LLM call when retrieval is weak, so it can't be argued away by a clever prompt — it's a code path, not a request to the model.
- Streaming answers + citations rendered immediately, separate from prose.

## What's weak / what I'd improve with more time

- **No JS rendering.** Pure `axios` + `cheerio` means React/Vue-heavy SPAs that hydrate content client-side will index empty or near-empty pages. Fix: add a headless-browser fallback (Playwright) for pages where the static HTML body is suspiciously short, rather than using it for every page (cost/speed trade-off).
- **Chunking is heuristic, not semantic.** A long page that shifts topics mid-paragraph can end up split awkwardly, and a very long single paragraph falls back to sentence-level splitting, which can produce a chunk with little independent meaning. A smarter version would chunk by detected headings (`<h1>`–`<h3>`) so each chunk maps to a logical section, which also gives a better "section title" for citations.
- **Retrieval is pure dense vector search.** No hybrid lexical (BM25) search and no re-ranking step. For a query that uses different vocabulary than the page (e.g. "pricing" vs. "plans and billing"), embeddings usually handle it, but a hybrid approach is more robust. A reranker (e.g. Cohere rerank, or just asking the LLM to rerank the top 10 before generating) would meaningfully improve precision on top of the current top-5.
- **Long pages are weaker.** Because chunking is uniform-size, a very long page (e.g. a full API reference) gets diluted across many similar chunks, and the one chunk that actually answers a specific question may not be the highest-scoring one if the page repeats similar terminology throughout. I'd want metadata-aware chunking (heading-based) and possibly chunk-level summaries layered in for very long pages.
- **No persistence.** Everything is in-memory — restart the backend and you lose every indexed site. Fine for a demo; for real use I'd persist chunks + embeddings to Postgres/pgvector keyed by site, so re-visiting a previously crawled site is instant.
- **Single concurrent site.** The whole app is built around "one site at a time," per the assignment's scope. Sessions are isolated by `siteId` so multi-site support is mostly a frontend routing change plus swapping the in-memory `Map` for persistent storage.
- **Eval is minimal.** `eval/run-eval.mjs` checks whether the expected page shows up in the cited sources for a small, hand-written set of questions (including one deliberately off-topic question to check the grounding fallback). It's a sanity check, not a rigorous benchmark — a real version would want a larger question set with human-labeled expected pages per question, and would measure recall@k rather than a binary pass/fail.

## Ambiguous calls I made

- **Page/depth limits (50 pages, depth 4):** the assignment said "sensible," not a specific number. I picked these so a typical small marketing site or docs subsection finishes in well under a minute even with the polite rate limit, while still going deep enough to reach real content pages, not just the homepage and top nav links.
- **Relevance threshold (0.3 cosine similarity) for the "I don't know" fallback:** chosen empirically as a conservative cutoff — low enough not to reject legitimate-but-loosely-worded matches, high enough to catch genuinely unrelated queries. This is the one number in the system most worth tuning per-domain if this went further.
- **In-memory vector store over a real vector DB:** justified above — small scale, no infra dependency, explicit trade-off noted rather than hidden.
- **No multi-site / no auth:** out of scope per "keep the surface small," one site at a time as suggested.

## Project structure

```
chat-with-website/
├── backend/
│   └── src/
│       ├── crawler.js      # scoped, polite crawl + boilerplate stripping
│       ├── chunker.js      # paragraph-aware chunking with overlap
│       ├── vectorStore.js  # embeddings + cosine similarity search
│       ├── rag.js          # grounded prompt construction + streaming
│       └── index.js        # Express routes (crawl, status, chat, SSE)
├── frontend/
│   └── src/
│       ├── components/     # UrlEntry, CrawlProgress, ChatView, SourceList
│       ├── lib/api.js      # fetch + SSE client
│       └── App.jsx         # screen routing (entry → progress → chat)
└── eval/
    └── run-eval.mjs        # basic retrieval-quality eval
```
