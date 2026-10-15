const $ = (id) => document.getElementById(id);
const KEY_NAMES = ['activate', 'exit', 'retry'];
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'OS'];
let s = EQ_merge();
let recording = null;

async function load() {
  const { rl, ...stored } = await chrome.storage.local.get(null);
  s = EQ_merge(stored);
  $('apiKey').value = s.apiKey;
  $('autoSendSec').value = s.autoSendSec;
  $('defaultPrompt').value = s.defaultPrompt;
  $('opacity').value = s.opacity;
  $('model').value = s.model;
  $('reasoning').value = s.reasoning;
  renderKeys();
  renderUsage();
}

function keyErrors() {
  const k = s.keys;
  const errs = [];
  if (!k.activate.ctrl && !k.activate.alt && !k.activate.meta)
    errs.push('Activate needs Ctrl, Alt or Meta, otherwise it fires while you type.');
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

async function renderUsage() {
  const { rl } = await chrome.storage.local.get('rl');
  if (!rl || rl.reqLeft == null) return ($('usage').textContent = '');
  const mins = Math.max(0, Math.ceil((rl.reqReset - Date.now()) / 6e4));
  $('usage').textContent = `Groq: ${rl.reqLeft}/${rl.reqLimit} requests left today` + (mins ? ` · fully resets in ~${mins} min` : '');
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
  const st = $('testStatus');
  st.className = 'status';
  st.textContent = 'Checking…';
  const res = await chrome.runtime.sendMessage({
    type: 'test',
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim(),
  });
  if (!res?.ok) {
    st.className = 'status err';
    st.textContent = `Failed: ${res?.error || 'no response'}`;
  } else if (!res.hasModel) {
    st.className = 'status err';
    st.textContent = 'Key works, but the model below is not available on your account.';
  } else {
    st.className = 'status ok';
    st.textContent = 'Key works.';
  }
});

$('openShortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

$('save').addEventListener('click', async () => {
  const sec = Math.max(0, Math.min(15, Math.round(Number($('autoSendSec').value) || 0)));
  Object.assign(s, {
    apiKey: $('apiKey').value.trim(),
    autoSendSec: sec,
    defaultPrompt: $('defaultPrompt').value.trim() || EQ_DEFAULTS.defaultPrompt,
    opacity: Number($('opacity').value),
    model: $('model').value.trim() || EQ_DEFAULTS.model,
    reasoning: $('reasoning').value,
  });
  await chrome.storage.local.set(s);
  $('autoSendSec').value = sec;
  const st = $('saveStatus');
  st.className = 'status ok';
  st.textContent = s.apiKey ? 'Saved. Press your activate shortcut on any page.' : 'Saved, but no API key yet.';
});

load();
