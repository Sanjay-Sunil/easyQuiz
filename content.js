(() => {
  const api = EQ_api;
  const alive = () => {
    try {
      return !!api.runtime?.id;
    } catch {
      return false;
    }
  };
  if (self.__easyQuiz?.alive()) return;
  self.__easyQuiz = { alive };

  const IS_TOP = window === window.top;
  const UI_KEYS = ['keys', 'autoSendSec', 'opacity', 'defaultPrompt'];
  let settings = EQ_merge();
  const loadSettings = () => api.storage.local.get(UI_KEYS).then((s) => (settings = EQ_merge(s)));
  loadSettings();
  api.storage.onChanged.addListener((_, area) => area === 'local' && alive() && loadSettings());

  const send = (msg) => (alive() ? api.runtime.sendMessage(msg).catch(() => null) : Promise.resolve(null));
  const block = (e) => {
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
  };
  const pick = (e) => ({
    key: e.key,
    code: e.code,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    metaKey: e.metaKey,
  });
  const OPTS = { capture: true, passive: false };
  const listen = (types, fn) => types.forEach((t) => window.addEventListener(t, fn, OPTS));
  const unlisten = (types, fn) => types.forEach((t) => window.removeEventListener(t, fn, OPTS));
  const KEY_EVENTS = ['keydown', 'keyup', 'keypress'];

  // ---------- iframes: forward the hotkey, and swallow keys while locked ----------
  if (!IS_TOP) {
    let locked = false;
    api.runtime.onMessage.addListener((m) => {
      if (m.type === 'lock') locked = m.on;
    });
    const onFrameKey = (e) => {
      if (!alive()) return unlisten(KEY_EVENTS, onFrameKey);
      if (locked) {
        block(e);
        if (e.type === 'keydown') send({ type: 'key', k: pick(e) });
      } else if (e.type === 'keydown' && EQ_match(e, settings.keys.activate)) {
        block(e);
        send({ type: 'activate' });
      }
    };
    listen(KEY_EVENTS, onFrameKey);
    return;
  }

  // ---------- top frame ----------
  const MOUSE_EVENTS = [
    'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'auxclick', 'contextmenu',
    'pointerdown', 'pointerup', 'pointermove', 'wheel', 'touchstart', 'touchmove', 'touchend',
    'dragstart', 'selectstart',
  ];

  // idle -> selecting -> capturing -> prompting -> loading -> result | error
  let state = 'idle';
  let ui = null;
  let drag = null;
  let image = null;
  let promptText = '';
  let lastPrompt = '';
  let autoTimer = null;
  let reqId = 0;
  const mouse = { x: innerWidth / 2, y: innerHeight / 2 };

  // pointermove, not mousemove: blocking pointerdown suppresses the compat mouse events mid-drag.
  window.addEventListener('pointermove', (e) => ((mouse.x = e.clientX), (mouse.y = e.clientY)), {
    capture: true,
    passive: true,
  });

  const CSS = `
    :host{--bg:rgba(255,255,255,.94);--fg:#1f1f1f;--mut:#8a8a8a;--bd:rgba(0,0,0,.12);--err:#b3261e}
    @media (prefers-color-scheme:dark){:host{--bg:rgba(32,32,32,.94);--fg:#e6e6e6;--mut:#8f8f8f;--bd:rgba(255,255,255,.14);--err:#f2b8b5}}
    *{box-sizing:border-box}
    .sel{position:fixed;display:none;border:1px dashed rgba(128,128,128,.9);background:rgba(128,128,128,.08);pointer-events:none}
    .box{position:fixed;display:none;font:12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg);
      background:var(--bg);border:1px solid var(--bd);border-radius:4px;opacity:var(--op,.9);pointer-events:none}
    .prompt{padding:3px 6px 4px;min-width:140px;max-width:min(420px,90vw);white-space:pre-wrap;word-break:break-word;overflow:hidden}
    .ph{color:var(--mut)}
    .caret{display:inline-block;width:1px;height:1.1em;margin:0 1px;background:var(--fg);vertical-align:-3px;animation:b 1s steps(1) infinite}
    @keyframes b{50%{opacity:0}}
    .bar{position:absolute;left:0;bottom:0;height:1px;width:0;background:var(--mut)}
    .pill{padding:1px 6px;font-weight:600;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pill.loading{font-weight:400;color:var(--mut)}
    .pill.err{color:var(--err)}
    .panel{right:12px;bottom:12px;width:min(300px,calc(100vw - 24px));max-height:40vh;overflow:auto;padding:8px 10px}
    .ans{font-weight:600;margin-bottom:4px;word-break:break-word}
    .exp{white-space:pre-wrap;word-break:break-word}
    .exp.err{color:var(--err)}
    .ans:empty,.exp:empty{display:none}
    .hint{margin-top:6px;font-size:10px;color:var(--mut)}
  `;

  function mount() {
    if (ui) return;
    const host = document.createElement('eq-layer');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:block;';
    const root = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      root.appendChild(style);
    }
    // Built with createElement (not innerHTML) so Trusted Types pages don't throw.
    const el = (cls, parent = root, tag = 'div') => {
      const n = document.createElement(tag);
      n.className = cls;
      parent.appendChild(n);
      return n;
    };
    const sel = el('sel');
    const prompt = el('box prompt');
    const txt = el('', prompt, 'span');
    el('caret', prompt, 'span');
    const ph = el('ph', prompt, 'span');
    const bar = el('bar', prompt);
    const pill = el('box pill');
    const panel = el('box panel');
    const ans = el('ans', panel);
    const exp = el('exp', panel);
    const hint = el('hint', panel);
    document.documentElement.appendChild(host);
    if (getComputedStyle(sel).position !== 'fixed') {
      // Firefox content scripts can't always adopt constructed sheets; use a <style> instead.
      const style = document.createElement('style');
      style.textContent = CSS;
      root.prepend(style);
    }
    ui = { host, sel, prompt, txt, ph, bar, pill, panel, ans, exp, hint };
    host.style.setProperty('--op', String(settings.opacity));

    listen(MOUSE_EVENTS, onMouse);
    send({ type: 'lock', on: true });
    document.activeElement?.blur?.();
    window.focus();
  }

  const show = (...els) => els.forEach((e) => (e.style.display = 'block'));
  const hide = (...els) => els.forEach((e) => (e.style.display = 'none'));

  function place(el, x, y, flipAbove = 0) {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (y + h > innerHeight - 4 && flipAbove) y = Math.max(4, y - h - flipAbove);
    el.style.left = `${Math.max(4, Math.min(x, innerWidth - w - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(y, innerHeight - h - 4))}px`;
  }

  function setState(s) {
    state = s;
    if (!ui) return;
    ui.host.style.cursor = s === 'selecting' ? 'crosshair' : s === 'loading' || s === 'capturing' ? 'progress' : 'default';
  }

  // ---------- flow ----------

  function activate() {
    if (!['idle', 'result', 'error'].includes(state)) return;
    mount();
    startSelecting();
  }

  function startSelecting() {
    reqId++;
    stopAuto();
    send({ type: 'cancel' });
    hide(ui.prompt, ui.pill, ui.panel, ui.sel);
    drag = null;
    setState('selecting');
  }

  function selRect() {
    return {
      x: Math.min(drag.x, mouse.x),
      y: Math.min(drag.y, mouse.y),
      w: Math.abs(mouse.x - drag.x),
      h: Math.abs(mouse.y - drag.y),
    };
  }

  function drawSel() {
    const r = selRect();
    Object.assign(ui.sel.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    show(ui.sel);
  }

  async function capture(r) {
    setState('capturing');
    ui.host.style.visibility = 'hidden';
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const res = await send({ type: 'capture', rect: r, vw: innerWidth });
    if (state !== 'capturing' || !ui) return; // exited meanwhile
    ui.host.style.visibility = '';
    if (!res?.ok) return showError(res?.error || 'Capture failed');
    image = res.image;
    startPrompt(r);
  }

  function startPrompt(r) {
    promptText = '';
    setState('prompting');
    renderPrompt();
    show(ui.prompt);
    place(ui.prompt, r.x, r.y + r.h + 6, r.h + 12);
    startAuto();
  }

  function renderPrompt() {
    ui.txt.textContent = promptText;
    ui.ph.textContent = promptText ? '' : 'type, or ↵';
  }

  function startAuto() {
    const sec = Number(settings.autoSendSec) || 0;
    if (sec <= 0) return;
    const bar = ui.bar;
    bar.style.transition = 'none';
    bar.style.width = '100%';
    void bar.offsetWidth; // restart the transition
    bar.style.transition = `width ${sec}s linear`;
    bar.style.width = '0';
    autoTimer = setTimeout(submit, sec * 1000);
  }

  function stopAuto() {
    clearTimeout(autoTimer);
    autoTimer = null;
    if (ui) {
      ui.bar.style.transition = 'none';
      ui.bar.style.width = '0';
    }
  }

  function submit() {
    stopAuto();
    lastPrompt = promptText.trim() || settings.defaultPrompt;
    ask();
  }

  async function ask() {
    const id = ++reqId;
    setState('loading');
    hide(ui.prompt, ui.sel, ui.panel);
    showPill('···', 'loading');
    const res = await send({ type: 'ask', image, prompt: lastPrompt });
    if (id !== reqId || !ui) return;
    if (!res?.ok) return showError(res?.error || 'No response');

    setState('result');
    const short = res.answer.length <= 48;
    showPill(res.answer ? (short ? res.answer : `${res.answer.slice(0, 45)}…`) : '—', '');
    showPanel(short ? '' : res.answer, res.explanation, false);
  }

  function showPill(text, cls) {
    ui.pill.className = `box pill ${cls}`;
    ui.pill.textContent = text;
    show(ui.pill);
    placePill();
  }

  function placePill() {
    if (ui?.pill.style.display === 'block') place(ui.pill, mouse.x + 14, mouse.y + 16, 32);
  }

  function showPanel(answer, explanation, isError) {
    if (!answer && !explanation) return hide(ui.panel);
    const k = settings.keys;
    ui.ans.textContent = answer;
    ui.exp.textContent = explanation;
    ui.exp.className = isError ? 'exp err' : 'exp';
    ui.hint.textContent = `${EQ_label(k.retry)} retry · ${EQ_label(k.activate)} new snip · ${EQ_label(k.exit)} close`;
    ui.panel.scrollTop = 0;
    show(ui.panel);
  }

  function showError(msg) {
    setState('error');
    hide(ui.prompt, ui.sel);
    showPill('!', 'err');
    showPanel('', msg, true);
  }

  function exit() {
    reqId++;
    stopAuto();
    drag = null;
    image = null;
    state = 'idle';
    if (!ui) return;
    unlisten(MOUSE_EVENTS, onMouse);
    ui.host.remove();
    ui = null;
    send({ type: 'cancel' });
    send({ type: 'lock', on: false });
  }

  // ---------- input ----------

  function handleKey(k) {
    const keys = settings.keys;
    if (EQ_match(k, keys.exit)) return exit();
    switch (state) {
      case 'prompting':
        if (k.key === 'Enter') return submit();
        stopAuto();
        if (k.key === 'Backspace') {
          promptText = k.ctrlKey ? promptText.replace(/\S+\s*$|\s+$/, '') : promptText.slice(0, -1);
        } else if (k.key.length === 1 && !k.ctrlKey && !k.metaKey) {
          promptText += k.key;
        }
        return renderPrompt();
      case 'result':
      case 'error':
        if (EQ_match(k, keys.retry) && image) return ask();
        if (EQ_match(k, keys.activate)) return startSelecting();
        return;
    }
  }

  function onKey(e) {
    if (!alive()) {
      unlisten(KEY_EVENTS, onKey);
      return exit();
    }
    if (state === 'idle') {
      if (e.type === 'keydown' && EQ_match(e, settings.keys.activate)) {
        block(e);
        activate();
      }
      return;
    }
    // While active, the page sees no keys at all.
    block(e);
    if (e.type === 'keydown' && !e.isComposing) handleKey(pick(e));
  }
  listen(KEY_EVENTS, onKey);

  function onMouse(e) {
    if (!ui) return;
    if (e.type === 'wheel' && ui.panel.style.display === 'block') {
      const r = ui.panel.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        ui.panel.scrollTop += e.deltaY;
      }
    }
    block(e);
    if (e.type === 'pointermove') {
      if (drag) drawSel();
      else placePill();
      return;
    }
    if (state !== 'selecting' || e.button !== 0) return;
    if (e.type === 'pointerdown') {
      drag = { x: e.clientX, y: e.clientY };
      drawSel();
    } else if (e.type === 'pointerup' && drag) {
      const r = selRect();
      drag = null;
      if (r.w < 6 || r.h < 6) return hide(ui.sel);
      capture(r);
    }
  }

  api.runtime.onMessage.addListener((m) => {
    if (m.type === 'activate') activate();
    else if (m.type === 'key' && state !== 'idle') handleKey(m.k);
    else if (m.type === 'status' && state === 'loading') showPill(m.text, 'loading');
  });
})();
