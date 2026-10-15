# easyQuiz

A browser extension: press a shortcut, drag around a question, press Enter, and the answer shows up next to your cursor. Uses Groq's free tier.

## Install

Run `./build.sh` first. It creates `dist/easyquiz-chromium.zip` and `dist/easyquiz-firefox.xpi`, which contain the same code.

### Chromium browsers (Chrome, Edge, Brave, Opera, Vivaldi, Arc)
1. Open the extensions page (`chrome://extensions`, `edge://extensions`, `brave://extensions`, …).
2. Turn on **Developer mode** and click **Load unpacked**, then select this folder.

### Zen, Firefox, LibreWolf, Floorp
**Permanent install (Zen, LibreWolf, Floorp, Firefox Developer/Nightly):**
1. Open `about:config` and set `xpinstall.signatures.required` to `false`.
2. Open `about:addons`, click ⚙ → **Install Add-on From File…**, and pick `dist/easyquiz-firefox.xpi`.

**Quick test in any Firefox-based browser (removed on restart):** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and pick `manifest.json`.

**Regular Firefox (release)** only installs signed add-ons. Signing is free and stays private (unlisted):
`npx web-ext sign --channel=unlisted --api-key=… --api-secret=…`, with keys from addons.mozilla.org → Developer Hub → API keys.

If the setup page shows **Allow access to websites**, click it. Firefox-based browsers sometimes leave site access off at install.

### Then
The setup page opens. Paste a Groq API key from <https://console.groq.com/keys>, click **Test**, choose your shortcuts, then click **Save**.

Safari isn't supported. It would need an Xcode conversion and a Mac.

## Use

| Step | Key |
| --- | --- |
| Start a snip (page locks, crosshair cursor) | `Alt+Q` (configurable) |
| Drag around the question | mouse |
| Type an optional note, then send | `Enter` (if you type nothing, it sends automatically after 3s) |
| Retry the same snip | `R` |
| New snip | activate key again |
| Close and get the page back | `Esc` |

Clicking the toolbar icon also starts a snip. `Alt+Shift+Q` is a backup shortcut handled by Chrome itself. You can change it at `chrome://extensions/shortcuts`.

## Free-tier limits

The default model is `qwen/qwen3.8-27b`, currently Groq's only vision model. Free-tier limits: 30 requests/min, 1,000/day, 8K tokens/min. Each image costs 2,048 tokens.
The extension reads Groq's rate-limit headers after every call. When you're close to the per-minute limit it waits on its own (`wait Ns` shows by the cursor). When the daily limit runs out it refuses with a clear message instead of failing on a 429. The setup page shows how many requests you have left today.

To save tokens, set Reasoning to **None**. Use **Medium** for harder math.

## Files

- `manifest.json` (MV3 manifest)
- `defaults.js` (shared settings and key-matching helpers)
- `content.js` (overlay: selection, prompt, answer, and the page lock)
- `background.js` (screenshot and crop, Groq call, rate-limit handling)
- `options.html` / `options.js` / `options.css` (setup page)
- `icons/` (logo: `logo.svg` plus PNG exports)
- `build.sh` (packages `dist/` for both browser families)

## Limitations

- It doesn't run on `chrome://` pages, the Chrome Web Store, or Chrome's built-in PDF viewer.
- Elements the page puts in fullscreen or the browser's top layer can cover the overlay.
- Paste and IME input don't work in the prompt, because keys are read directly so the page never sees them.
