const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const page = await browser.newPage();
  page.on('console', m => console.log('CONSOLE', m.type(), m.text()));
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('requestfailed', r => console.log('REQFAILED', r.url(), r.failure()?.errorText));
  page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
  await page.goto('http://localhost:5173/login', { waitUntil: 'load', timeout: 20000 });
  await new Promise(r => setTimeout(r, 4000));
  console.log('ROOT LEN', await page.evaluate(() => document.getElementById('root').innerHTML.length));
  await browser.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
