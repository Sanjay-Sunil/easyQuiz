// Shared by background, content scripts and the options page.
// Assigned to `self` (not const) so re-injecting the script never throws.

self.EQ_DEFAULTS = {
  apiKey: '',
  model: 'qwen/qwen3.8-27b',
  reasoning: 'low', // none | low | medium
  autoSendSec: 3, // send the default prompt if nothing is typed within N s (0 = off)
  opacity: 0.9,
  defaultPrompt: 'Answer this question.',
  keys: {
    activate: { code: 'KeyQ', alt: true },
    exit: { code: 'Escape' },
    retry: { code: 'KeyR' },
  },
};

self.EQ_merge = (stored = {}) => ({
  ...self.EQ_DEFAULTS,
  ...stored,
  keys: { ...self.EQ_DEFAULTS.keys, ...(stored.keys || {}) },
});

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
