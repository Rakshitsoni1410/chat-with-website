export default function SourceList({ sources }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="source-list">
      <span className="source-label">Sources</span>
      <div className="source-pills">
        {sources.map((s, i) => (
          <a
            key={s.url + i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="source-pill"
            title={s.url}
          >
            <span className="source-pill-index">{i + 1}</span>
            <span className="source-pill-title">{s.title || s.url}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
