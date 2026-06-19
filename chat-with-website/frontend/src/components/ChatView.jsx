import { useState, useRef, useEffect } from "react";
import { streamChat } from "../lib/api";
import SourceList from "./SourceList";

export default function ChatView({ siteId, siteUrl, pageCount, chunkCount, onReset }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    const query = input.trim();
    if (!query || isStreaming) return;

    setInput("");
    const userMsg = { role: "user", content: query };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg, { role: "assistant", content: "", sources: [], streaming: true }]);
    setIsStreaming(true);

    await streamChat({
      siteId,
      query,
      history,
      onSources: (sources) => {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], sources };
          return next;
        });
      },
      onDelta: (text) => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + text };
          return next;
        });
      },
      onDone: () => {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], streaming: false };
          return next;
        });
        setIsStreaming(false);
      },
      onError: (message) => {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: `Something went wrong: ${message}`,
            streaming: false,
          };
          return next;
        });
        setIsStreaming(false);
      },
    });
  }

  const hostname = (() => {
    try {
      return new URL(siteUrl).hostname;
    } catch {
      return siteUrl;
    }
  })();

  return (
    <div className="chat-screen">
      <header className="chat-header">
        <div className="chat-header-info">
          <span className="chat-header-dot" />
          <div>
            <p className="chat-header-host">{hostname}</p>
            <p className="chat-header-meta">
              {pageCount} page{pageCount === 1 ? "" : "s"} · {chunkCount} chunk{chunkCount === 1 ? "" : "s"} indexed
            </p>
          </div>
        </div>
        <button className="chat-header-reset" onClick={onReset}>
          New site
        </button>
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Ask a question about this site to get started.</p>
            <p className="chat-empty-sub">
              Answers are grounded in what's actually on the pages we crawled — if it's not
              there, we'll say so.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
            <div className="chat-msg-bubble">
              {msg.role === "assistant" && msg.content === "" && msg.streaming ? (
                <span className="typing-dots">
                  <span /> <span /> <span />
                </span>
              ) : (
                <FormattedAnswer text={msg.content} />
              )}
            </div>
            {msg.role === "assistant" && !msg.streaming && msg.sources?.length > 0 && (
              <SourceList sources={msg.sources} />
            )}
          </div>
        ))}
      </div>

      <form className="chat-input-bar" onSubmit={handleSend}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something about this site…"
          className="chat-input"
          disabled={isStreaming}
        />
        <button type="submit" className="chat-send" disabled={isStreaming || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

/** Render assistant text, stripping the raw "**Sources:**" block since we render SourceList separately */
function FormattedAnswer({ text }) {
  const cleaned = text.split(/\*\*Sources:\*\*/i)[0].trim();
  const paragraphs = cleaned.split(/\n+/).filter(Boolean);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </>
  );
}
