const $ = (id) => document.getElementById(id);
const api = EQ_api;
const ALL_SITES = { origins: ['<all_urls>'] };
const KEY_NAMES = ['activate', 'askText', 'exit', 'retry'];
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'OS'];
let s = EQ_merge();
let recording = null;

async function load() {
  // Only settings: leave rate-limit state (rlKeys, keyCursor) to the background.
  const { rl, rlKeys, keyCursor, setupShown, ...stored } = await api.storage.local.get(null);
  s = EQ_merge(stored);
  renderKeyList(s.apiKeys.length ? s.apiKeys : ['']);
  $('geminiKey').value = s.geminiKey || '';
  $('geminiModel').value = s.geminiModel;
  $('autoSendSec').value = s.autoSendSec;
  $('defaultPrompt').value = s.defaultPrompt;
  $('opacity').value = s.opacity;
  $('model').value = s.model;
  $('reasoning').value = s.reasoning;
  renderKeys();
  renderUsage();
  renderAccess();
}

function keyErrors() {
  const k = s.keys;
  const errs = [];
  if (!k.activate.ctrl && !k.activate.alt && !k.activate.meta)
    errs.push('Activate needs Ctrl, Alt or Meta, otherwise it fires while you type.');
  if (!k.askText.ctrl && !k.askText.alt && !k.askText.meta)
    errs.push('Ask text needs Ctrl, Alt or Meta, otherwise it fires while you type.');
  for (let i = 0; i < KEY_NAMES.length; i++)
    for (let j = i + 1; j < KEY_NAMES.length; j++)
      if (EQ_label(k[KEY_NAMES[i]]) === EQ_label(k[KEY_NAMES[j]]))
        errs.push(`${KEY_NAMES[i]} and ${KEY_NAMES[j]} use the same keys.`);
  if (['Enter', 'Backspace'].includes(k.exit.code) || ['Enter', 'Backspace'].includes(k.retry.code))
    errs.push('Enter and Backspace are reserved for the prompt.');
  return errs;
}

function renderKeys() {
  for (const name of KEY_NAMES) {
    const b = $(`k-${name}`);
    b.textContent = recording === name ? 'Press keys…' : EQ_label(s.keys[name]);
    b.classList.toggle('rec', recording === name);
  }
  const errs = keyErrors();
  $('keyErrors').textContent = errs.join(' ');
  $('save').disabled = errs.length > 0;
}

// ---------- API keys ----------

function addKeyRow(value = '') {
  const row = document.createElement('div');
  row.className = 'row key-row';
  const input = document.createElement('input');
  Object.assign(input, { type: 'password', placeholder: 'gsk_…', autocomplete: 'off', spellcheck: false, value });
  input.className = 'key-input';
  const remove = document.createElement('button');
  Object.assign(remove, { type: 'button', textContent: '×', title: 'Remove key', className: 'icon' });
  remove.addEventListener('click', () => {
    row.remove();
    if (!$('keyList').children.length) addKeyRow();
  });
  const status = document.createElement('p');
  status.className = 'status key-status';
  row.append(input, remove);
  $('keyList').append(row, status);
  return input;
}

function renderKeyList(keys) {
  $('keyList').replaceChildren();
  keys.forEach((k) => addKeyRow(k));
}

const keyInputs = () => [...document.querySelectorAll('.key-input')];
const readKeys = () => [...new Set(keyInputs().map((i) => i.value.trim()).filter(Boolean))];

$('addKey').addEventListener('click', () => addKeyRow().focus());

$('testGemini').addEventListener('click', async () => {
  const key = $('geminiKey').value.trim();
  const model = $('geminiModel').value.trim();
  const st = $('geminiStatus');
  if (!key) { st.className = 'status key-status err'; st.textContent = 'Enter a key first.'; return; }
  st.className = 'status key-status'; st.textContent = 'Checking…';
  const res = await api.runtime.sendMessage({ type: 'testGemini', apiKey: key, model });
  st.className = `status key-status ${res?.ok ? 'ok' : 'err'}`;
  st.textContent = res?.ok ? 'Works.' : `Failed: ${res?.error || 'no response'}`;
});

async function renderUsage() {
  const { rlKeys = {} } = await api.storage.local.get('rlKeys');
  const now = Date.now();
  const known = s.apiKeys.map((k) => rlKeys[k.slice(-8)]).filter((r) => r?.reqLeft != null);
  if (!known.length) return ($('usage').textContent = '');
  const left = known.reduce((n, r) => n + (r.reqReset > now ? r.reqLeft : r.reqLimit), 0);
  const limit = known.reduce((n, r) => n + r.reqLimit, 0);
  $('usage').textContent =
    `Groq: about ${left}/${limit} requests left today` + (known.length > 1 ? ` across ${known.length} keys` : '');
}

document.querySelectorAll('.kb').forEach((b) =>
  b.addEventListener('click', () => {
    recording = b.dataset.key;
    renderKeys();
  })
);

window.addEventListener(
  'keydown',
  (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (MODIFIERS.includes(e.key)) return;
    s.keys = {
      ...s.keys,
      [recording]: { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey },
    };
    recording = null;
    renderKeys();
  },
  true
);

$('test').addEventListener('click', async () => {
  const model = $('model').value.trim();
  const rows = keyInputs().filter((i) => i.value.trim());
  if (!rows.length) return;
  await Promise.all(
    rows.map(async (input) => {
      const st = input.parentElement.nextElementSibling;
      st.className = 'status key-status';
      st.textContent = 'Checking…';
      const res = await api.runtime.sendMessage({ type: 'test', apiKey: input.value.trim(), model });
      const ok = res?.ok && res.hasModel;
      st.className = `status key-status ${ok ? 'ok' : 'err'}`;
      st.textContent = !res?.ok
        ? `Failed: ${res?.error || 'no response'}`
        : res.hasModel
          ? 'Works.'
          : 'Works, but the model below is not available on this account.';
    })
  );
});

$('openShortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  if (api.commands?.openShortcutSettings) return api.commands.openShortcutSettings(); // Firefox 137+
  if (navigator.userAgent.includes('Firefox'))
    return ($('shortcutHelp').textContent = 'Open about:addons → ⚙ → Manage Extension Shortcuts.');
  api.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// Firefox can install MV3 extensions without site access; the overlay and screenshots need it.
async function renderAccess() {
  const ok = await api.permissions.contains(ALL_SITES).catch(() => true);
  $('access').hidden = ok;
}
$('grantAccess').addEventListener('click', async () => {
  await api.permissions.request(ALL_SITES).catch(() => false);
  renderAccess();
});

$('save').addEventListener('click', async () => {
  const sec = Math.max(0, Math.min(15, Math.round(Number($('autoSendSec').value) || 0)));
  Object.assign(s, {
    apiKeys: readKeys(),
    geminiKey: $('geminiKey').value.trim(),
    geminiModel: $('geminiModel').value.trim() || EQ_DEFAULTS.geminiModel,
    autoSendSec: sec,
    defaultPrompt: $('defaultPrompt').value.trim() || EQ_DEFAULTS.defaultPrompt,
    opacity: Number($('opacity').value),
    model: $('model').value.trim() || EQ_DEFAULTS.model,
    reasoning: $('reasoning').value,
  });
  await api.storage.local.set(s);
  await api.storage.local.remove('apiKey'); // pre-0.2 single key, now in apiKeys
  renderKeyList(s.apiKeys.length ? s.apiKeys : ['']);
  $('autoSendSec').value = sec;
  const st = $('saveStatus');
  st.className = 'status ok';
  const n = s.apiKeys.length;
  st.textContent = !n
    ? 'Saved, but no API key yet.'
    : `Saved${n > 1 ? ` (${n} keys, used in turn)` : ''}. Press your activate shortcut on any page.`;
});

load();
