import { useState } from "react";

export default function UrlEntry({ onSubmit, error }) {
  const [url, setUrl] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (!url.trim()) return;
    let normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = "https://" + normalized;
    }
    onSubmit(normalized);
  }

  return (
    <div className="entry-screen">
      <div className="entry-card">
        <p className="entry-eyebrow">Chat with a website</p>
        <h1 className="entry-title">
          Point it at a site.
          <br />
          Ask it anything.
        </h1>
        <p className="entry-sub">
          We'll crawl the pages, read what's there, and answer your questions —
          with links back to exactly where each answer came from.
        </p>

        <form onSubmit={handleSubmit} className="entry-form">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="docs.example.com"
            className="entry-input"
            autoFocus
          />
          <button type="submit" className="entry-button">
            Crawl site →
          </button>
        </form>

        {error && <p className="entry-error">{error}</p>}

        <div className="entry-meta">
          <span>Same-domain only</span>
          <span className="dot">·</span>
          <span>Respects robots.txt</span>
          <span className="dot">·</span>
          <span>Max 50 pages</span>
        </div>
      </div>
    </div>
  );
}
