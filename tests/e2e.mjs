// End-to-end test: loads the extension in headless Chromium, mocks the Groq API
// inside the background service worker, and drives the full snip flow.
// Run: npm test   (or CHROME=/path/to/chromium npm test)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('./output/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failed++;
};

const PAGE = `<!doctype html><meta charset="utf-8"><body style="font:18px sans-serif;margin:40px">
<h2>Q3. What is 6 × 7?</h2><p>A) 36 &nbsp; B) 42 &nbsp; C) 48 &nbsp; D) 54</p>
<input id="inp"><iframe id="fr" src="https://quiz.test/frame" style="display:block;width:400px;height:100px"></iframe>
<script>window.__keys=[];addEventListener('keydown',e=>__keys.push(e.key));</script>`;
const FRAME = `<!doctype html><input id="fi"><script>window.__keys=[];addEventListener('keydown',e=>__keys.push(e.key));</script>`;

const ctx = await chromium.launchPersistentContext('', {
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chromium' }),
  headless: true,
  viewport: { width: 1100, height: 700 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

try {
  await ctx.route('https://quiz.test/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: r.request().url().endsWith('/frame') ? FRAME : PAGE })
  );
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const extId = sw.url().split('/')[2];

  // Mock Groq: canned answers, real-looking rate-limit headers, optional 429.
  await sw.evaluate(() => {
    self.__calls = [];
    self.__mode = 'ok';
    const real = self.fetch;
    self.fetch = async (url, init = {}) => {
      if (!String(url).startsWith('https://api.groq.com')) return real(url, init);
      const key = (init.headers?.Authorization || '').replace('Bearer ', '');
      self.__calls.push({ url: String(url), key, body: init.body ? JSON.parse(init.body) : null });
      const headers = {
        'content-type': 'application/json',
        'x-ratelimit-limit-requests': '1000',
        'x-ratelimit-remaining-requests': '990',
        'x-ratelimit-reset-requests': '1m26s',
        'x-ratelimit-limit-tokens': '8000',
        'x-ratelimit-remaining-tokens': '7000',
        'x-ratelimit-reset-tokens': '2s',
      };
      if (String(url).endsWith('/models'))
        return new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3.8-27b' }] }), { headers });
      await new Promise((r) => setTimeout(r, 200));
      if (self.__busyKey === key)
        return new Response('{"error":{"message":"rate"}}', { status: 429, headers: { ...headers, 'retry-after': '60' } });
      if (self.__mode === '429') {
        self.__mode = 'ok';
        return new Response('{"error":{"message":"rate"}}', { status: 429, headers: { ...headers, 'retry-after': '1' } });
      }
      const content = 'ANSWER: B) 42\nEXPLANATION: 6 × 7 = 42, which is option B.';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers });
    };
  });
  const calls = () => sw.evaluate(() => self.__calls.filter((c) => c.body).length);
  const usedKeys = () => sw.evaluate(() => self.__calls.filter((c) => c.body).map((c) => c.key));
  const lastBody = () => sw.evaluate(() => self.__calls.filter((c) => c.body).at(-1)?.body);

  // Setup page
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.fill('#keyList .key-input', 'gsk_test');
  await opt.click('#test');
  await opt.waitForFunction(() => document.querySelector('#keyList .key-status')?.textContent === 'Works.');
  check('setup page: key test', true);
  await opt.click('#save');

  const page = await ctx.newPage();
  await page.goto('https://quiz.test/');
  await sleep(300);
  const overlay = () => page.evaluate(() => !!document.querySelector('eq-layer'));
  const snip = async () => {
    await page.mouse.move(30, 30);
    await page.mouse.down();
    await page.mouse.move(520, 130, { steps: 8 });
    await page.mouse.up();
    await sleep(400);
  };

  // Activate + lock
  await page.click('#inp');
  await page.keyboard.press('Alt+KeyQ');
  await sleep(150);
  check('Alt+Q opens overlay', await overlay());
  await page.keyboard.type('xyz');
  check('page gets no keys while locked', (await page.inputValue('#inp')) === '');

  // Snip + prompt + answer
  await snip();
  await page.keyboard.type('which option');
  await page.keyboard.press('Enter');
  await sleep(700);
  const body = await lastBody();
  check('sends prompt + image to Groq', body?.messages[1].content[0].text === 'which option' &&
    body.messages[1].content[1].image_url.url.startsWith('data:image/'));
  writeFileSync(`${OUT}crop.png`, Buffer.from(body.messages[1].content[1].image_url.url.split(',')[1], 'base64'));
  await page.mouse.move(700, 300);
  await page.screenshot({ path: `${OUT}result.png` });

  // Retry, 429 handling
  const n = await calls();
  await sw.evaluate(() => (self.__mode = '429'));
  await page.keyboard.press('KeyR');
  await sleep(2500);
  check('retry recovers from 429', (await calls()) === n + 2);

  // Exit
  await page.keyboard.press('Escape');
  await sleep(150);
  check('Esc closes overlay', !(await overlay()));
  await page.click('#inp');
  await page.keyboard.type('ok');
  check('page usable after exit', (await page.inputValue('#inp')) === 'ok');

  // Auto-send
  const before = await calls();
  await page.keyboard.press('Alt+KeyQ');
  await snip();
  await sleep(3600);
  check('auto-send with default prompt', (await calls()) === before + 1 &&
    (await lastBody()).messages[1].content[0].text === 'Answer this question.');
  await page.keyboard.press('Escape');

  // Several keys: round-robin, and a rate-limited key is skipped immediately
  await opt.bringToFront();
  await opt.click('#addKey');
  await opt.locator('.key-input').nth(1).fill('gsk_second_key_bbbbbbbb');
  await opt.click('#addKey');
  await opt.locator('.key-input').nth(2).fill('gsk_third_key_cccccccc');
  await opt.click('#save');
  check('setup page saves 3 keys', /3 keys/.test(await opt.textContent('#saveStatus')));
  await page.bringToFront();
  const n0 = (await usedKeys()).length;
  await page.keyboard.press('Alt+KeyQ');
  await snip();
  await page.keyboard.press('Enter');
  await sleep(600);
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('KeyR');
    await sleep(600);
  }
  const rot = (await usedKeys()).slice(n0);
  check('keys rotate per request', new Set(rot).size === 3, JSON.stringify(rot));
  await sw.evaluate(() => (self.__busyKey = 'gsk_second_key_bbbbbbbb'));
  const t0 = Date.now();
  const n1 = (await usedKeys()).length;
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyR');
    await sleep(700);
  }
  const after = (await usedKeys()).slice(n1);
  check('429 key is skipped without waiting', after.filter((k) => k === 'gsk_second_key_bbbbbbbb').length === 1 &&
    after.length === 4 && Date.now() - t0 < 4000, JSON.stringify(after));
  await sw.evaluate(() => (self.__busyKey = null));
  await page.keyboard.press('Escape');

  // Activation from inside an iframe
  const frame = page.frames().find((f) => f.url().endsWith('/frame'));
  await frame.click('#fi');
  await page.keyboard.press('Alt+KeyQ');
  await sleep(300);
  check('activates from inside iframe', await overlay());
  await page.keyboard.type('abc');
  check('iframe gets no keys while locked', (await frame.inputValue('#fi')) === '');
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc works with iframe focus', !(await overlay()));
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await ctx.close();
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
