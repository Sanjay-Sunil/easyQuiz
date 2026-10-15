# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Setup

There's no build step. The extension is plain JavaScript.

```bash
git clone https://github.com/Sanjay-Sunil/easyQuiz.git
cd easyQuiz
npm install          # dev tools only: web-ext (lint) and Playwright (tests)
```

Load it in a browser:
- **Chromium:** `chrome://extensions` → turn on Developer mode → **Load unpacked** → select this folder. Click the reload icon after each change.
- **Firefox / Zen:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → select `manifest.json`.

## Checks

```bash
npm run lint         # Firefox add-on linter plus a syntax check
npm test             # end-to-end test in headless Chromium (Groq is mocked, so no key needed)
npm run build        # dist/easyquiz-chromium.zip + dist/easyquiz-firefox.xpi
```

The tests download Playwright's Chromium. To use a browser you already have, run `CHROME=/usr/bin/chromium npm test`.

## Code map

| File | What it does |
| --- | --- |
| `content.js` | Overlay in the page: selection, prompt, answer, and blocking input to the page |
| `background.js` | Screenshot and crop, Groq request, rate-limit handling |
| `defaults.js` | Settings shared by every part, key matching, `browser`/`chrome` API shim |
| `options.*` | Setup page |

## Pull requests

- Keep each PR focused on one change, and match the existing style: plain JS, no dependencies, no bundler.
- Run `npm run lint` and `npm test` before opening one.
- If your change affects how the extension looks or behaves, describe what you tested and in which browser.
- Update `CHANGELOG.md` under an `Unreleased` heading.

## Releasing (maintainers)

Bump `version` in `manifest.json` and `package.json`, update the changelog, then:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

The release workflow builds both packages and attaches them to a GitHub release.
