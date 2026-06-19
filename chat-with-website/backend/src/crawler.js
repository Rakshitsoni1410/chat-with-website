import axios from "axios";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";

const USER_AGENT = "ChatWithWebsiteBot/1.0 (polite crawler; respects robots.txt)";
const REQUEST_DELAY_MS = 500; // 0.5s between requests — polite rate limit
const MAX_PAGES = 50;
const MAX_DEPTH = 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = ""; // strip fragment
    // Remove trailing slash for consistency (except root)
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return null;
  }
}

function isSameDomain(urlA, baseOrigin) {
  try {
    const u = new URL(urlA);
    return u.origin === baseOrigin;
  } catch {
    return false;
  }
}

/** Strip boilerplate: nav, footer, header, cookie banners, scripts, styles */
function extractCleanText($) {
  // Remove noise elements
  $(
    "nav, footer, header, script, style, noscript, iframe, [role='navigation'], [role='banner'], [aria-label='navigation'], .cookie-banner, .cookie-notice, #cookie-notice, .nav, .navbar, .footer, .header, .sidebar, .ad, .advertisement, .popup, .modal-overlay"
  ).remove();

  // Try to find main content area first
  const mainSelectors = ["main", "article", "[role='main']", ".content", ".main-content", "#content", "#main"];
  let contentEl = null;
  for (const sel of mainSelectors) {
    if ($(sel).length) {
      contentEl = $(sel).first();
      break;
    }
  }

  const target = contentEl || $("body");

  // Get text, collapse whitespace
  const rawText = target
    .text()
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return rawText;
}

function extractLinks($, baseUrl, baseOrigin) {
  const links = new Set();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl).href;
      const norm = normalizeUrl(resolved);
      if (norm && isSameDomain(norm, baseOrigin)) {
        // Skip obviously non-page URLs
        if (/\.(pdf|png|jpg|jpeg|gif|svg|webp|css|js|xml|json|zip|tar|gz|mp4|mp3)(\?|$)/i.test(norm)) return;
        links.add(norm);
      }
    } catch {
      // ignore bad hrefs
    }
  });
  return links;
}

async function fetchRobotsTxt(baseOrigin) {
  try {
    const robotsUrl = `${baseOrigin}/robots.txt`;
    const res = await axios.get(robotsUrl, {
      timeout: 8000,
      headers: { "User-Agent": USER_AGENT },
    });
    return robotsParser(robotsUrl, res.data);
  } catch {
    return null; // no robots.txt or fetch failed — proceed freely
  }
}

/**
 * Crawl a website starting from startUrl.
 * Returns an array of { url, title, text } objects.
 * Emits progress via onProgress(pagesCrawled, totalQueued, currentUrl).
 */
export async function crawlSite(startUrl, { onProgress } = {}) {
  const base = new URL(startUrl);
  const baseOrigin = base.origin;

  // Fetch and parse robots.txt
  const robots = await fetchRobotsTxt(baseOrigin);

  const visited = new Set();
  const queue = [{ url: normalizeUrl(startUrl), depth: 0 }];
  const pages = [];

  while (queue.length > 0 && pages.length < MAX_PAGES) {
    const { url, depth } = queue.shift();

    if (!url || visited.has(url)) continue;
    if (depth > MAX_DEPTH) continue;

    // Respect robots.txt
    if (robots && !robots.isAllowed(url, USER_AGENT)) {
      console.log(`[crawler] Skipping (robots.txt disallowed): ${url}`);
      continue;
    }

    visited.add(url);

    try {
      onProgress?.(pages.length, queue.length + visited.size, url);

      const res = await axios.get(url, {
        timeout: 12000,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html",
        },
        maxRedirects: 5,
      });

      const contentType = res.headers["content-type"] || "";
      if (!contentType.includes("text/html")) continue;

      const $ = cheerio.load(res.data);
      const title = $("title").text().trim() || url;
      const text = extractCleanText($);

      if (text.length > 100) {
        // skip nearly-empty pages
        pages.push({ url, title, text });
      }

      // Discover more links
      if (depth < MAX_DEPTH) {
        const links = extractLinks($, url, baseOrigin);
        for (const link of links) {
          if (!visited.has(link)) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }

      await sleep(REQUEST_DELAY_MS);
    } catch (err) {
      console.warn(`[crawler] Failed to fetch ${url}: ${err.message}`);
    }
  }

  console.log(`[crawler] Done. Crawled ${pages.length} pages from ${baseOrigin}`);
  return pages;
}
