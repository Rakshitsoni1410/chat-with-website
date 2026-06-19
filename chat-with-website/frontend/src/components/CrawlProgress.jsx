const STATUS_LABELS = {
  crawling: "Crawling pages",
  indexing: "Reading and indexing content",
  ready: "Ready",
  error: "Something went wrong",
};

export default function CrawlProgress({ url, status, progress, pageCount, chunkCount, error, onCancel }) {
  const label = STATUS_LABELS[status] || "Working";

  return (
    <div className="entry-screen">
      <div className="entry-card progress-card">
        <p className="entry-eyebrow">{new URL(url).hostname}</p>
        <h2 className="progress-title">{label}…</h2>

        {status === "crawling" && (
          <div className="progress-detail">
            <div className="progress-bar-track">
              <div className="progress-bar-fill indeterminate" />
            </div>
            <p className="progress-line">
              {progress?.crawled ?? 0} page{progress?.crawled === 1 ? "" : "s"} fetched
            </p>
            {progress?.currentUrl && (
              <p className="progress-url" title={progress.currentUrl}>
                {truncateUrl(progress.currentUrl)}
              </p>
            )}
          </div>
        )}

        {status === "indexing" && (
          <div className="progress-detail">
            <div className="progress-bar-track">
              <div className="progress-bar-fill indeterminate" />
            </div>
            <p className="progress-line">
              Chunking and embedding {pageCount} page{pageCount === 1 ? "" : "s"}…
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="progress-detail">
            <p className="entry-error">{error}</p>
            <button className="entry-button" onClick={onCancel} style={{ marginTop: 16 }}>
              Try another URL
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function truncateUrl(url) {
  if (url.length <= 60) return url;
  return url.slice(0, 57) + "…";
}
