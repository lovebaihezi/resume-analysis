# Resume Analyze

Cloudflare Worker fullstack app for uploading PDF resumes, extracting structured
resume data with Workers AI and Cloudflare AI Gateway, storing resume/JD records
in Durable Objects, and serving a React UI from Worker static assets.

## Stack

- Frontend: React, React Router v7, XState, SWR, ArkType, StyleX, Tailwind CSS,
  daisyUI.
- Backend: Express on Cloudflare Workers with `nodejs_compat`.
- Cloudflare: Durable Objects, Workers AI, AI Gateway, Worker static assets.
- Quality: Vitest API and browser tests, Playwright e2e entrypoint, Oxlint,
  Prettier.

## Commands

```sh
pnpm install
pnpm run cf-typegen
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:real-ai
pnpm run build
pnpm run dev:local
```

`pnpm run test:real-ai` runs the real PDF extraction test through the Cloudflare
Workers Vitest pool with remote bindings enabled. It downloads
`https://skyzh.github.io/files/cv.pdf`, posts it to the Worker API, waits for
the async resume analysis job, validates the JSON with ArkType, and checks that
the extracted content matches the CV. It requires Cloudflare credentials for
remote bindings. `pnpm run test:e2e` runs the deployed-app Playwright test. It
is skipped unless `E2E_BASE_URL` is set.

`pnpm run dev:local` starts a simulated local app with Vite, Express, and the
in-memory test service implementations. `pnpm run dev` runs Wrangler and uses
the real Cloudflare bindings; with the Workers AI binding, Wrangler requires
Cloudflare credentials for the remote dev session.

## Cloudflare Setup

The Durable Object classes, Queues, Workers AI binding, and non-secret AI
Gateway settings are already declared in `wrangler.jsonc`. Resume extraction
uses the `collects-auto-ai` gateway with Google AI Studio BYOK configured in
Cloudflare, so the app does not need a local `CF_AIG_TOKEN`. The GitHub Actions
PR checks and deploy workflow expect `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` secrets. The token must be able to run the Worker with
remote bindings and use the configured AI resources.
