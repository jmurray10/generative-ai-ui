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
  no auth: anyone who can reach it can spend your model credits, so put it behind your
  own auth or proxy before exposing it publicly. What it does on its own:
  - CORS is off unless `CORS_ORIGIN` is set (the `web` container serves the API on the
    page's origin).
  - `/voice` rejects browsers from other sites, and caps voice sessions per client
    (`VOICE_MAX_SESSIONS`, `VOICE_OPENS_PER_MIN`).
  - Generation, chat and routing are rate-limited per client IP in memory
    (`RATE_LIMIT_PER_MIN`), with prompt and spec size caps.
- Generated **ReactArtifact** and **CustomWidget** code runs in a sandboxed
  `<iframe sandbox="allow-scripts">` with no same-origin access, so it cannot read the
  parent page, cookies, or the shared app state, navigate the top window, or open
  popups. A Content-Security-Policy limits what each frame can fetch: nothing for
  CustomWidget; the CDN hosts plus open-meteo, coingecko and github for ReactArtifact.
  A frame can still navigate itself, which the CSP doesn't govern. The host detects
  that, stops trusting the frame and removes it. So treat what a generated app can see
  (what you type into it) as potentially leaving it. Registry bindings are evaluated by
  `expr-eval-fork` (the maintained fork that patches the prototype-pollution bugs in
  unmaintained `expr-eval`), never `eval`, and model colors that become CSS must be hex.
- Never commit real API keys. `.env` is gitignored, and `.dockerignore` keeps every
  `.env*` file except `.env.example` out of the images. Use `.env.example` as the
  template. `scripts/security-check.mjs` re-checks these behaviors against a running stack.

## Contact

**Jeff Murray** — [@jmurray10](https://github.com/jmurray10) ·
jeff.murray@alumni.upenn.edu ·
[LinkedIn](https://www.linkedin.com/in/jeff-murray-ai).
