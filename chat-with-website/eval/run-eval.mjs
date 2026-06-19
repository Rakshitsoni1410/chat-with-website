/**
 * Basic retrieval-quality eval.
 *
 * Run this AFTER a site has been crawled and indexed via the running backend
 * (i.e. you have a siteId from POST /api/crawl that reached status "ready").
 *
 * It sends each question to /api/chat and checks whether the expected URL
 * (or a URL containing the expected substring) appears among the cited
 * sources. This measures retrieval quality, not answer quality — it tells
 * you whether the right page was found, independent of how the LLM phrased
 * the final answer.
 *
 * Usage:
 *   1. Edit QUESTIONS below to match the site you crawled.
 *   2. node eval/run-eval.mjs <siteId>
 */

const API_BASE = process.env.API_URL || "http://localhost:3001";

// Example question set for https://docs.anthropic.com (edit per target site)
const QUESTIONS = [
  {
    question: "What models does Claude offer?",
    expectedUrlContains: "models",
  },
  {
    question: "How do I get an API key?",
    expectedUrlContains: "api",
  },
  {
    question: "What is the capital of France?", // intentionally off-topic
    expectGrounded: false, // should trigger the "couldn't find" fallback
  },
];

async function askQuestion(siteId, question) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteId, query: question, history: [] }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sources = [];
  let answerText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split("\n\n");
    buffer = messages.pop() || "";

    for (const msg of messages) {
      const eventMatch = msg.match(/^event: (.+)$/m);
      const dataMatch = msg.match(/^data: (.+)$/m);
      if (!eventMatch || !dataMatch) continue;
      const data = JSON.parse(dataMatch[1]);
      if (eventMatch[1] === "sources") sources = data.sources;
      if (eventMatch[1] === "delta") answerText += data.text;
    }
  }

  return { sources, answerText };
}

async function main() {
  const siteId = process.argv[2];
  if (!siteId) {
    console.error("Usage: node run-eval.mjs <siteId>");
    process.exit(1);
  }

  let passed = 0;
  const results = [];

  for (const q of QUESTIONS) {
    console.log(`\nQ: ${q.question}`);
    const { sources, answerText } = await askQuestion(siteId, q.question);
    const urls = sources.map((s) => s.url);
    console.log(`  Sources: ${urls.join(", ") || "(none)"}`);

    let pass;
    if (q.expectGrounded === false) {
      // Should NOT have found a confident answer
      pass = /couldn't find|don't have|not covered/i.test(answerText);
      console.log(`  Expected: no answer found → ${pass ? "PASS" : "FAIL"}`);
    } else {
      pass = urls.some((u) => u.includes(q.expectedUrlContains));
      console.log(
        `  Expected URL containing "${q.expectedUrlContains}" → ${pass ? "PASS" : "FAIL"}`
      );
    }

    if (pass) passed++;
    results.push({ question: q.question, pass });
  }

  console.log(`\n${passed}/${QUESTIONS.length} passed`);
}

main().catch((err) => {
  console.error("Eval failed:", err.message);
  process.exit(1);
});
