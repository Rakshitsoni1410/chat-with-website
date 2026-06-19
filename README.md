# Chat with a Website

Give the app a URL, it crawls the site, indexes its content, and lets you ask questions grounded in the actual pages. Every answer includes citations back to the source pages.

---

## Stack

* **Frontend:** React + Vite
* **Backend:** Node.js + Express
* **LLM:** Google Gemini 2.0 Flash
* **Embeddings:** Gemini `text-embedding-004`
* **Vector Store:** In-memory cosine similarity search
* **Streaming:** Server-Sent Events (SSE)

---

# Running the Project

## Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:

```env
GEMINI_API_KEY=your_api_key_here
PORT=3001
FRONTEND_URL=http://localhost:5173
```

Start the backend:

```bash
npm run dev
```

Runs on:

```
http://localhost:3001
```

---

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on:

```
http://localhost:5173
```

Open the browser and paste a website URL. After crawling and indexing finish, you can start asking questions.

---

## Required Environment Variables

| Variable       | Location      | Purpose                    |
| -------------- | ------------- | -------------------------- |
| GEMINI_API_KEY | backend/.env  | Gemini chat and embeddings |
| PORT           | backend/.env  | Backend port               |
| FRONTEND_URL   | backend/.env  | CORS origin                |
| VITE_API_URL   | frontend/.env | Backend URL                |

---

# Architecture

```text
User
 ↓
URL Input
 ↓
Crawler
 ↓
Boilerplate Removal
 ↓
Chunking
 ↓
Gemini Embeddings
 ↓
In-memory Vector Store
 ↓
Cosine Similarity Search
 ↓
Gemini 2.0 Flash
 ↓
Streaming Answer + Citations
```

---

# Crawling Strategy

### Scope

* Same-origin only
* Maximum 50 pages
* Maximum depth of 4

### Politeness

* Respects `robots.txt`
* 500ms delay between requests
* Custom User-Agent

### Boilerplate Removal

Removes:

* navigation bars
* headers
* footers
* scripts
* styles
* cookie banners

Content extraction prefers:

* `<main>`
* `<article>`

instead of indexing the entire body.

---

# Chunking Strategy

Pages are split into chunks of roughly:

* ~1600 characters (~400 tokens)
* 200-character overlap

Chunks retain:

* URL
* Page title

which enables citations later.

---

# Retrieval

Each chunk is embedded using:

```text
text-embedding-004
```

Retrieval uses cosine similarity and returns the top 5 chunks.

### Why an In-Memory Store?

Typical sites produce fewer than 250 chunks.

Brute-force cosine similarity over a few hundred vectors takes only a few milliseconds, so introducing Pinecone or pgvector would add infrastructure complexity without improving quality.

### Trade-Off

**Pros**

* Fast
* Simple
* Zero infrastructure

**Cons**

* Index disappears when the server restarts.

---

# Grounding and Hallucination Prevention

Before calling Gemini:

1. Retrieved chunks are filtered using:

```js
MIN_RELEVANCE_SCORE = 0.3
```

2. If no chunk exceeds that threshold, the application never calls the model and instead returns:

> I couldn't find information about that on this website.

3. Gemini is instructed to:

* answer only from supplied context
* avoid outside knowledge
* cite sources
* state when information is missing

Temperature is kept low (`0.2`) to encourage faithful answers.

---

# Streaming Responses

Answers stream token-by-token using Server-Sent Events (SSE).

Source citations are sent separately from the answer text, ensuring citations come from retrieval rather than being invented by the model.

---

# What Works

✅ Same-domain crawling

✅ robots.txt compliance

✅ Rate limiting

✅ Boilerplate removal

✅ Paragraph-aware chunking

✅ Gemini embeddings

✅ Cosine similarity retrieval

✅ Grounded responses

✅ "I don't know" fallback

✅ Streaming answers

✅ Structured citations

---

# Limitations

### No JavaScript Rendering

Sites that depend heavily on client-side rendering may return little or no content.

**Future improvement:** Add a Playwright fallback.

---

### Heuristic Chunking

Chunks are based on size rather than semantic sections.

**Future improvement:** Heading-based chunking.

---

### Dense Vector Search Only

Current retrieval uses embeddings only.

**Future improvement:**

* BM25 hybrid search
* Reranking

---

### No Persistence

Everything is stored in memory.

**Future improvement:** PostgreSQL + pgvector.

---

### Single-Site Scope

The application focuses on one website at a time, following the assignment requirements.

---

# Project Structure

```text
chat-with-website
│
├── backend
│   ├── crawler.js
│   ├── chunker.js
│   ├── vectorStore.js
│   ├── rag.js
│   └── index.js
│
├── frontend
│   ├── components
│   ├── lib
│   └── App.jsx
│
└── eval
    └── run-eval.mjs
```

---

# Future Improvements

* Playwright support for JavaScript-rendered sites
* Hybrid search (BM25 + vector search)
* Reranking
* Persistent storage with pgvector
* Multi-site support
* More comprehensive retrieval evaluation

---

# Design Decisions

* One site at a time
* Maximum 50 pages
* Maximum depth of 4
* Top-5 retrieval
* Similarity threshold = 0.3
* In-memory vector store

These choices prioritize simplicity, explainability, and fast iteration, which align with the scope of the assignment.
