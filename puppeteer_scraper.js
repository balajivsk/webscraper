const puppeteer = require("puppeteer");

(async () => {
  const url = process.argv[2];
  if (!url) {
    console.error("No URL passed.");
    process.exit(1);
  }

  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });

    const content = await page.evaluate(() => {
      return document.body.innerText;
    });

    console.log(content);
    await browser.close();
  } catch (error) {
    console.error("Puppeteer error:", error);
    process.exit(1);
  }
})();
