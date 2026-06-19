const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

export async function startCrawl(url) {
  const res = await fetch(`${API_BASE}/api/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to start crawl");
  }
  return res.json(); // { siteId, url }
}

export async function getStatus(siteId) {
  const res = await fetch(`${API_BASE}/api/status/${siteId}`);
  if (!res.ok) throw new Error("Failed to fetch status");
  return res.json();
}

export async function endSession(siteId) {
  try {
    await fetch(`${API_BASE}/api/session/${siteId}`, { method: "DELETE" });
  } catch {
    // best-effort cleanup
  }
}

/**
 * Stream a chat response via Server-Sent Events.
 * Callbacks: onSources(sources[]), onDelta(text), onDone(), onError(message)
 */
export async function streamChat({ siteId, query, history, onSources, onDelta, onDone, onError }) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteId, query, history }),
  });

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    onError?.(err.error || "Chat request failed");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by double newlines
    const messages = buffer.split("\n\n");
    buffer = messages.pop() || ""; // keep incomplete chunk in buffer

    for (const message of messages) {
      if (!message.trim()) continue;
      const eventMatch = message.match(/^event: (.+)$/m);
      const dataMatch = message.match(/^data: (.+)$/m);
      if (!eventMatch || !dataMatch) continue;

      const event = eventMatch[1];
      let data;
      try {
        data = JSON.parse(dataMatch[1]);
      } catch {
        continue;
      }

      if (event === "sources") onSources?.(data.sources);
      else if (event === "delta") onDelta?.(data.text);
      else if (event === "done") onDone?.();
      else if (event === "error") onError?.(data.message);
    }
  }
}
