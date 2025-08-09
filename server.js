// server.js
const express = require("express");
const fetch = require("node-fetch"); // Node 18 has global fetch, but keep this for safety on Render
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");

const app = express();
app.use(express.json());

app.get("/", (_req, res) => res.send("OK"));

function looksDynamic(html) {
  // quick & dirty heuristic: very little HTML + scripts => likely client-rendered
  return html && html.length < 300 && /<script/i.test(html);
}

async function scrapeStatic(url) {
  const resp = await fetch(url, { timeout: 15000 });
  const html = await resp.text();
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
  return text;
}

async function scrapeDynamic(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    const text = await page.evaluate(() => document.body.innerText);
    return text;
  } finally {
    await browser.close();
  }
}

app.post("/scrape", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing url" });

    // Probe once to decide
    let dynamic = false;
    try {
      const resp = await fetch(url, { timeout: 10000 });
      const html = await resp.text();
      dynamic = looksDynamic(html);
      if (!dynamic) {
        const $ = cheerio.load(html);
        const text = $("body").text().replace(/\s+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
        return res.json({ type: "static", text });
      }
    } catch {
      dynamic = true; // if probing fails, try dynamic as fallback
    }

    // Dynamic path
    const text = await scrapeDynamic(url);
    return res.json({ type: "dynamic", text });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on :${port}`));
