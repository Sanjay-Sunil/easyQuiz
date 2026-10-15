// Chromium runs this as a service worker; Firefox loads defaults.js via manifest `scripts`.
if (typeof importScripts === 'function') importScripts('defaults.js');
const api = EQ_api;

const API = 'https://api.groq.com/openai/v1';
const IMAGE_TOKENS = 2048; // Groq counts every image as 2048 input tokens
const PROMPT_TOKENS = 500; // system + user text, rounded up
const MAX_SIDE = 1600; // px; larger crops are downscaled before upload
const OUT_TOKENS = { none: 400, low: 1500, medium: 4000 };

const SYSTEM = `You help a student check answers to practice questions shown in a screenshot.
Reply in exactly this format and nothing else:
ANSWER: <final answer only. For multiple choice give the option label and its text, e.g. "B) 42". Otherwise a word, number or short phrase.>
EXPLANATION: <at most 3 short sentences on why>
If the screenshot is not a question, put a one-line summary in ANSWER and details in EXPLANATION.
Plain text only: no markdown, no LaTeX.`;

const jobs = new Map(); // tabId -> AbortController of the in-flight ask

// ---------- lifecycle ----------

api.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') api.runtime.openOptionsPage();
  // Content scripts only auto-load on new page loads; cover tabs that are already open.
  const tabs = await api.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of tabs) inject(t.id).catch(() => {});
});

api.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === 'activate' && tab?.id != null) toTop(tab.id, { type: 'activate' });
});

api.action.onClicked.addListener((tab) => toTop(tab.id, { type: 'activate' }));

function inject(tabId) {
  return api.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['defaults.js', 'content.js'],
  });
}

async function toTop(tabId, msg) {
  try {
    await api.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch {
    try {
      await inject(tabId);
      await api.tabs.sendMessage(tabId, msg, { frameId: 0 });
    } catch {
      // Restricted page (chrome://, Web Store, PDF viewer): nothing we can do.
    }
  }
}

// ---------- messages ----------

// Zen (and possibly other Firefox forks) can deliver content-script messages
// without `sender.tab`; the sender is then the active tab, since that is where
// the user just pressed a key or dragged.
async function senderTab(sender) {
  if (sender.tab) return sender.tab;
  const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

api.runtime.onMessage.addListener((m, sender, reply) => {
  senderTab(sender).then((tab) => handle(m, tab, reply));
  return ['capture', 'ask', 'test'].includes(m.type);
});

function handle(m, tab, reply) {
  const tabId = tab?.id;
  switch (m.type) {
    case 'activate': // from an iframe -> top frame
    case 'key':
      if (tabId != null) api.tabs.sendMessage(tabId, m, { frameId: 0 }).catch(() => {});
      return;
    case 'lock': // from top frame -> every frame
      if (tabId != null) api.tabs.sendMessage(tabId, m).catch(() => {});
      return;
    case 'cancel':
      jobs.get(tabId)?.abort();
      return;
    case 'capture':
      if (!tab) return reply(fail('Capture failed: no active tab'));
      capture(tab, m).then(reply);
      return;
    case 'ask':
      ask(m, tabId).then(reply);
      return;
    case 'test':
      testKey(m.apiKey, m.model).then(reply);
      return;
  }
}

const fail = (error) => ({ ok: false, error });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- screenshot ----------

async function capture(tab, { rect, vw }) {
  try {
    const shot = await api.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const bmp = await createImageBitmap(await (await fetch(shot)).blob());
    const s = bmp.width / vw;
    const sx = Math.max(0, Math.round(rect.x * s));
    const sy = Math.max(0, Math.round(rect.y * s));
    const sw = Math.min(bmp.width - sx, Math.round(rect.w * s));
    const sh = Math.min(bmp.height - sy, Math.round(rect.h * s));
    const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k)));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    let blob = await canvas.convertToBlob({ type: 'image/png' });
    if (blob.size > 1.5e6) blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return { ok: true, image: await blobToDataUrl(blob) };
  } catch (e) {
    return fail(`Capture failed: ${e.message || e}`);
  }
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(bin)}`;
}

// ---------- Groq ----------

async function ask({ image, prompt }, tabId) {
  const s = EQ_merge(await api.storage.local.get(null));
  if (!s.apiKey) return fail('Add your Groq API key in the extension options.');

  jobs.get(tabId)?.abort();
  const ac = new AbortController();
  jobs.set(tabId, ac);
  const status = (text) =>
    tabId != null && api.tabs.sendMessage(tabId, { type: 'status', text }, { frameId: 0 }).catch(() => {});

  const maxOut = OUT_TOKENS[s.reasoning] ?? OUT_TOKENS.low;
  const body = {
    model: s.model,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: image } },
        ],
      },
    ],
    max_completion_tokens: maxOut,
    temperature: s.reasoning === 'none' ? 0.7 : 1,
    reasoning_effort: s.reasoning,
  };
  if (s.reasoning !== 'none') body.reasoning_format = 'hidden';

  try {
    const blocked = await waitForBudget(IMAGE_TOKENS + PROMPT_TOKENS + maxOut, status, ac.signal);
    if (blocked) return fail(blocked);

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${API}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      await recordLimits(res.headers);
      const data = await res.json().catch(() => null);

      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after')) || 10;
        if (attempt === 0 && wait <= 30) {
          await countdown(wait, status, ac.signal);
          continue;
        }
        return fail(`Rate limited. Try again in ${Math.ceil(wait)}s.`);
      }
      // A model without reasoning support rejects these params; retry without them.
      if (res.status === 400 && 'reasoning_effort' in body && /reasoning/i.test(data?.error?.message || '')) {
        delete body.reasoning_effort;
        delete body.reasoning_format;
        continue;
      }
      if (!res.ok) return fail(data?.error?.message || `Groq error ${res.status}`);

      const text = data?.choices?.[0]?.message?.content || '';
      if (!text.trim()) return fail('Empty response. Retry, or lower the reasoning level in options.');
      return { ok: true, ...parseAnswer(text) };
    }
    return fail('Gave up after retries.');
  } catch (e) {
    if (e.name === 'AbortError') return fail('Cancelled');
    return fail('Network error. Check your connection.');
  } finally {
    if (jobs.get(tabId) === ac) jobs.delete(tabId);
  }
}

function parseAnswer(raw) {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const a = text.match(/ANSWER\s*:\s*([^\n]*)/i);
  const ex = text.match(/EXPLANATION\s*:\s*([\s\S]*)/i);
  const clean = (t) =>
    t
      .replace(/\\boxed\{([^}]*)\}/g, '$1')
      .replace(/\*\*|__|\$/g, '')
      .trim();
  if (a) return { answer: clean(a[1]), explanation: ex ? clean(ex[1]) : '' };
  const first = text.split('\n')[0];
  return { answer: clean(first), explanation: text.includes('\n') ? clean(text) : '' };
}

// ---------- rate limits ----------
// Groq returns remaining budget in headers on every response; we persist the
// latest values and wait (or refuse) before sending a request that would 429.

const dur = (s) => {
  if (!s) return 0;
  let ms = 0;
  for (const [, n, u] of s.matchAll(/([\d.]+)(ms|h|m|s)/g)) ms += n * { ms: 1, s: 1e3, m: 6e4, h: 3.6e6 }[u];
  return ms;
};

const fmt = (ms) => {
  const m = Math.ceil(ms / 6e4);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

async function recordLimits(h) {
  const num = (k) => (h.get(k) == null ? null : Number(h.get(k)));
  const now = Date.now();
  const rl = {
    reqLimit: num('x-ratelimit-limit-requests'),
    reqLeft: num('x-ratelimit-remaining-requests'),
    reqReset: now + dur(h.get('x-ratelimit-reset-requests')),
    tokLimit: num('x-ratelimit-limit-tokens'),
    tokLeft: num('x-ratelimit-remaining-tokens'),
    tokReset: now + dur(h.get('x-ratelimit-reset-tokens')),
  };
  if (rl.reqLeft != null || rl.tokLeft != null) await api.storage.local.set({ rl });
}

async function waitForBudget(estimate, status, signal) {
  const { rl } = await api.storage.local.get('rl');
  if (!rl) return null;
  const now = Date.now();
  if (rl.reqLeft === 0 && rl.reqReset > now) return `Daily limit reached. Resets in ${fmt(rl.reqReset - now)}.`;
  const need = Math.min(estimate, rl.tokLimit ?? estimate);
  if (rl.tokLeft != null && rl.tokLeft < need && rl.tokReset > now) {
    const wait = (rl.tokReset - now) / 1000;
    if (wait > 90) return `Token limit reached. Try again in ${fmt(wait * 1000)}.`;
    await countdown(wait, status, signal);
  }
  return null;
}

async function countdown(sec, status, signal) {
  for (let n = Math.ceil(sec); n > 0; n--) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    status(`wait ${n}s`);
    await sleep(1000);
  }
  status('···');
}

async function testKey(apiKey, model) {
  try {
    const r = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const d = await r.json().catch(() => null);
    if (!r.ok) return fail(d?.error?.message || `HTTP ${r.status}`);
    return { ok: true, hasModel: (d?.data || []).some((m) => m.id === model) };
  } catch {
    return fail('Network error');
  }
}
