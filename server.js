/* server.js - Smart Web Scraper (Render friendly)
 * - GET  /health     -> simple health check
 * - POST /scrape     -> { url, mode?: 'auto'|'static'|'dynamic', returnHtml?: false }
 * Returns: { url, modeUsed, title, lang, charCount, wordCount, text }
 */

const express = require('express');
const axios = require('axios').default;
const cheerio = require('cheerio');
const Chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const app = express();
app.use(express.json({ limit: '2mb' }));

// -------- helpers --------
function cleanText(text) {
  return (
    text
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')    // collapse huge blank blocks
      .replace(/\t+/g, ' ')
      .replace(/[ \u00A0]{2,}/g, ' ')// collapse spaces
      .trim()
  );
}

function extractTextFromHtml(html) {
  const $ = cheerio.load(html, { decodeEntities: true });

  // Remove non-content nodes
  ['script', 'noscript', 'style', 'iframe', 'header', 'nav', 'footer'].forEach(sel => $(sel).remove());

  // Prefer main/article when available
  let container = $('main, article');
  if (!container.length) container = $('body');

  const title = ($('title').text() || '').trim();
  const text = cleanText(container.text() || '');
  return { title, text, htmlLength: html.length };
}

function guessLanguage(text) {
  // quick hint: detect Tamil (U+0B80–U+0BFF)
  const hasTamil = /[\u0B80-\u0BFF]/.test(text);
  if (hasTamil) return 'ta';
  // default heuristic
  return 'en';
}

async function fetchStatic(url) {
  const res = await axios.get(url, {
    timeout: 30000,
    maxRedirects: 5,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
    },
    responseType: 'text',
    validateStatus: s => s >= 200 && s < 400
  });
  const { title, text, htmlLength } = extractTextFromHtml(res.data || '');
  return { title, text, htmlLength };
}

async function fetchDynamic(url) {
  const browser = await puppeteer.launch({
    args: [...Chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: Chromium.defaultViewport,
    executablePath: await Chromium.executablePath(),
    headless: true
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
    );
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    // Give SPAs a beat
    await page.waitForTimeout(1200);
    const html = await page.content();
    const { title, text, htmlLength } = extractTextFromHtml(html);
    return { title, text, htmlLength };
  } finally {
    await browser.close().catch(() => {});
  }
}

// Try static first; fallback to dynamic if needed
async function smartScrape(url, mode = 'auto') {
  if (mode === 'static') {
    const res = await fetchStatic(url);
    return { ...res, modeUsed: 'static' };
  }
  if (mode === 'dynamic') {
    const res = await fetchDynamic(url);
    return { ...res, modeUsed: 'dynamic' };
  }

  // AUTO mode
  try {
    const staticRes = await fetchStatic(url);
    const tooSmall = staticRes.text.length < 1000; // tweak threshold
    const clearlyBlocked =
      /enable javascript|please enable javascript|blocked by/i.test(staticRes.text);

    if (tooSmall || clearlyBlocked) {
      const dynRes = await fetchDynamic(url);
      return { ...dynRes, modeUsed: 'dynamic' };
    }
    return { ...staticRes, modeUsed: 'static' };
  } catch (e) {
    // Static failed, try dynamic as fallback
    const dynRes = await fetchDynamic(url);
    return { ...dynRes, modeUsed: 'dynamic' };
  }
}

// -------- routes --------
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.post('/scrape', async (req, res) => {
  try {
    const { url, mode = 'auto' } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Provide JSON body: { "url": "https://..." }' });
    }

    const result = await smartScrape(url, mode);
    const lang = guessLanguage(result.text);
    const charCount = result.text.length;
    const wordCount = result.text.split(/\s+/).filter(Boolean).length;

    return res.json({
      url,
      modeUsed: result.modeUsed,
      title: result.title,
      lang,
      charCount,
      wordCount,
      text: result.text
    });
  } catch (err) {
    console.error('SCRAPE ERROR:', err?.message, err?.stack);
    res.status(500).json({ error: 'Scrape failed', detail: String(err?.message || err) });
  }
});

// -------- start --------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Smart scraper listening on :${port}`);
});
