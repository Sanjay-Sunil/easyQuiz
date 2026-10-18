// Shared by background, content scripts and the options page.
// Assigned to `self` (not const) so re-injecting the script never throws.

// Firefox (and Zen, LibreWolf…) expose promise-based `browser`; Chromium exposes `chrome`.
self.EQ_api = globalThis.browser ?? globalThis.chrome;

self.EQ_DEFAULTS = {
  apiKeys: [], // rotated per request; see pickKey() in background.js
  model: 'qwen/qwen3.8-27b',
  reasoning: 'low', // none | low | medium
  autoSendSec: 3, // send the default prompt if nothing is typed within N s (0 = off)
  opacity: 0.9,
  defaultPrompt: 'Answer this question.',
  geminiKey: '',
  geminiModel: 'gemini-3.8-flash',
  keys: {
    activate: { code: 'KeyQ', alt: true },
    askText: { code: 'KeyW', alt: true },
    exit: { code: 'Escape' },
    retry: { code: 'KeyR' },
  },
};

self.EQ_merge = ({ apiKey, ...stored } = {}) => {
  const s = {
    ...self.EQ_DEFAULTS,
    ...stored,
    keys: { ...self.EQ_DEFAULTS.keys, ...(stored.keys || {}) },
  };
  // Before 0.2 a single key was stored as `apiKey`.
  if (!s.apiKeys?.length && apiKey) s.apiKeys = [apiKey];
  s.apiKeys = (s.apiKeys || []).map((k) => k.trim()).filter(Boolean);
  return s;
};

// `e` may be a KeyboardEvent or a plain object with the same fields.
self.EQ_match = (e, kb) =>
  !!kb &&
  e.code === kb.code &&
  !!e.ctrlKey === !!kb.ctrl &&
  !!e.altKey === !!kb.alt &&
  !!e.shiftKey === !!kb.shift &&
  !!e.metaKey === !!kb.meta;

self.EQ_label = (kb) => {
  if (!kb) return '—';
  const key = kb.code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '');
  return [kb.ctrl && 'Ctrl', kb.alt && 'Alt', kb.shift && 'Shift', kb.meta && 'Meta', key]
    .filter(Boolean)
    .join('+');
};
