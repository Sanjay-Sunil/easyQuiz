# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-15

### Added
- Snip any area of the page with a shortcut, add an optional prompt, and get the answer from a Groq vision model next to your cursor
- Longer explanations shown in a small side panel; retry, new snip and exit keys
- Page lock while the overlay is open: keys, clicks and scrolling don't reach the page or its embedded frames
- Auto-send when nothing is typed; configurable keys, prompt, opacity, model and reasoning level
- Stays within Groq's free-tier limits by reading its rate-limit headers and waiting when needed
- Works in Chromium browsers (Chrome, Edge, Brave, …) and Firefox-based browsers (Firefox, Zen, …)
