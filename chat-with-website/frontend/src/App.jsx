import { useState, useEffect, useRef } from "react";
import "./App.css";
import UrlEntry from "./components/UrlEntry";
import CrawlProgress from "./components/CrawlProgress";
import ChatView from "./components/ChatView";
import { startCrawl, getStatus, endSession } from "./lib/api";

const POLL_INTERVAL_MS = 1200;

export default function App() {
  const [siteId, setSiteId] = useState(null);
  const [siteUrl, setSiteUrl] = useState(null);
  const [status, setStatus] = useState(null); // crawling | indexing | ready | error
  const [progress, setProgress] = useState({});
  const [pageCount, setPageCount] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);
  const [entryError, setEntryError] = useState(null);
  const [crawlError, setCrawlError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    return () => clearInterval(pollRef.current);
  }, []);

  async function handleUrlSubmit(url) {
    setEntryError(null);
    setCrawlError(null);
    try {
      const { siteId: id, url: normalizedUrl } = await startCrawl(url);
      setSiteId(id);
      setSiteUrl(normalizedUrl);
      setStatus("crawling");

      pollRef.current = setInterval(async () => {
        try {
          const s = await getStatus(id);
          setStatus(s.status);
          setProgress(s.progress || {});
          setPageCount(s.pageCount || 0);
          setChunkCount(s.chunkCount || 0);
          if (s.error) setCrawlError(s.error);

          if (s.status === "ready" || s.status === "error") {
            clearInterval(pollRef.current);
          }
        } catch {
          // transient — keep polling
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      setEntryError(err.message);
    }
  }

  async function handleReset() {
    clearInterval(pollRef.current);
    if (siteId) await endSession(siteId);
    setSiteId(null);
    setSiteUrl(null);
    setStatus(null);
    setProgress({});
    setPageCount(0);
    setChunkCount(0);
    setEntryError(null);
    setCrawlError(null);
  }

  if (!siteId || status === null) {
    return <UrlEntry onSubmit={handleUrlSubmit} error={entryError} />;
  }

  if (status === "ready") {
    return (
      <ChatView
        siteId={siteId}
        siteUrl={siteUrl}
        pageCount={pageCount}
        chunkCount={chunkCount}
        onReset={handleReset}
      />
    );
  }

  return (
    <CrawlProgress
      url={siteUrl}
      status={status}
      progress={progress}
      pageCount={pageCount}
      chunkCount={chunkCount}
      error={crawlError}
      onCancel={handleReset}
    />
  );
}
