# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- **Preferred:** open a private report via GitHub Security Advisories
  ("Report a vulnerability" on the repository's **Security** tab).
- **Or email:** jeff.murray@alumni.upenn.edu with details and steps to reproduce.

I'll acknowledge within a few days and keep you updated on a fix. This is a personal
demo project maintained on a best-effort basis.

## Good to know

- Prompts are sent to the **xAI API** (`api.x.ai`) to generate UI specs. The voice
  agent streams microphone audio to **Grok speech-to-speech** (`wss://api.x.ai/v1/realtime`).
  `VOICE_PROVIDER=gemini` sends that traffic to Google instead. There is no database and
  no auth — put the server behind your own auth or proxy before exposing it, and set
  `CORS_ORIGIN` if the API is not same-origin. `/api/generate` and `/api/stream` are
  rate-limited in memory (`RATE_LIMIT_PER_MIN`).
- Generated **ReactArtifact** and **CustomWidget** code runs in a sandboxed
  `<iframe sandbox="allow-scripts">` with no same-origin access, so it cannot read the
  parent page, cookies, or the shared app state. CustomWidget documents also set a
  Content-Security-Policy that blocks network access. ReactArtifact allows the CDN hosts
  it loads and `https:` fetches. Registry bindings are evaluated by `expr-eval-fork`
  (the maintained fork that patches the prototype-pollution bugs in unmaintained
  `expr-eval`), never `eval`. Treat generated code as untrusted all the same.
- Never commit real API keys. `.env` is gitignored; use `.env.example` as the template.

## Contact

**Jeff Murray** — [@jmurray10](https://github.com/jmurray10) ·
jeff.murray@alumni.upenn.edu ·
[LinkedIn](https://www.linkedin.com/in/jeff-murray-ai).
