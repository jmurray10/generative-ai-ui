# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- **Preferred:** open a private report via GitHub Security Advisories
  ("Report a vulnerability" on the repository's **Security** tab).
- **Or email:** jeff.murray@alumni.upenn.edu with details and steps to reproduce.

I'll acknowledge within a few days and keep you updated on a fix. This is a personal
demo project maintained on a best-effort basis.

## Good to know

- Prompts are sent to the **Google Gemini API** to generate UI specs; the voice agent
  streams microphone audio to the **Gemini Live API**. There is no database and no auth —
  put it behind your own auth/proxy before exposing it publicly.
- Generated **ReactArtifact** and **CustomWidget** code runs in a sandboxed
  `<iframe sandbox="allow-scripts">` with no same-origin access, so it cannot read the
  parent page, cookies, or the shared app state. Registry bindings are evaluated by a safe
  expression parser (`expr-eval`), never `eval`. Treat generated code as untrusted all the
  same.
- Never commit real API keys. `.env` is gitignored; use `.env.example` as the template.

## Contact

**Jeff Murray** — [@jmurray10](https://github.com/jmurray10) ·
jeff.murray@alumni.upenn.edu ·
[LinkedIn](https://www.linkedin.com/in/jeff-murray-ai).
