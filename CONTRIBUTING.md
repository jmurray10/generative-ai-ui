# Contributing

Thanks for taking a look. This is a small, focused demo of generative UI, but issues and
pull requests are welcome.

## Getting started

See the [README](./README.md#run-it) for full setup. In short:

```bash
npm install
npm run dev          # client on :5173, proxies the API to the server on :8080
```

Single-server production build:

```bash
npm run build
npm start            # http://localhost:8080
```

## Before opening a PR

- Keep changes focused and match the surrounding style.
- `npm run typecheck` and `npm run build` pass (CI runs both on every pull request).
- If you touch the component registry (`src/client/engine/components.tsx`), keep the
  system prompt (`src/server/prompt.ts`) in sync — the model only knows the vocabulary the
  prompt describes.
- For a live end-to-end smoke test against a running container, set a `GEMINI_API_KEY` and
  run `node scripts/e2e.mjs` (needs Docker + Chrome; not part of CI).

## Reporting bugs and ideas

Open an issue with steps to reproduce. If a specific prompt triggers the problem, paste the
prompt and (if you can) the generated spec. For security issues, see
[SECURITY.md](./SECURITY.md) instead of opening a public issue.

## Code of conduct

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Contact

Maintained by **Jeff Murray** — [@jmurray10](https://github.com/jmurray10) ·
jeff.murray@alumni.upenn.edu ·
[LinkedIn](https://www.linkedin.com/in/jeff-murray-ai).
