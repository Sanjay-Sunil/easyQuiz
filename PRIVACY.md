# Privacy

easyQuiz has no server, no analytics and no tracking.

**What leaves your browser.** Only when you press Enter, or when auto-send fires, easyQuiz sends two things to the Groq API (`api.groq.com`) using **your own API key**:
- the screenshot of the area you selected
- the text you typed, or the default prompt

Nothing else from the page is sent, and nothing is sent to anyone else. Groq's handling of that data is covered by [Groq's privacy policy](https://groq.com/privacy-policy/).

**What is stored, and where.** Your API key, settings and the latest Groq rate-limit counters are kept in the browser's extension storage (`storage.local`) on your device. Screenshots are kept in memory only until you close the overlay.

**Permissions and why they're needed**

| Permission | Why |
| --- | --- |
| Access to all sites (`<all_urls>`) | Draw the overlay on any page and capture the visible tab |
| `scripting` | Add the overlay to tabs that were already open when the extension was installed |
| `storage` | Save your key and settings |
