const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|favicon/.test(m.text())) errors.push(m.text());
  });

  await page.goto(BASE + '/login', { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => document.getElementById('root')?.innerHTML.length > 0, { timeout: 15000 });
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise((r) => setTimeout(r, 500));

  // Click "Continue with Demo Data"
  const clicked = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('button, p, span, div'));
    const target = els.find((el) => el.textContent.trim() === 'Continue with Demo Data');
    if (!target) return false;
    target.click();
    return true;
  });
  console.log('clicked demo button:', clicked);

  await new Promise((r) => setTimeout(r, 1500));
  console.log('url after click:', page.url());
  await page.screenshot({ path: path.join(OUT, 'demo_dashboard.png'), fullPage: true });

  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log('--- body text sample ---');
  console.log(bodyText);

  console.log('--- console/page errors ---');
  console.log(errors.length ? errors : 'none');

  await browser.close();
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
