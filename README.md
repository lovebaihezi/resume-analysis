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

## Project Arch

```mermaid
flowchart LR
    User["User"]
    Browser["Browser"]
    Worker["Cloudflare Worker"]
    ToMarkdown["Cloudflare AI toMarkdown"]
    DurableObject["Cloudflare DurableObject"]
    Gemini["Gemini"]

    User -->|"Choose or drag PDF"| Browser
    Browser -->|"PDF file sent"| Worker
    Worker -->|"PDF to Markdown"| ToMarkdown
    ToMarkdown -->|"Markdown resume text"| Gemini
    Gemini -->|"Stream token: basic.name = Asuka"| Worker
    Worker -->|"Streaming progress and preview"| Browser
    Worker -->|"Store extracted text only"| DurableObject
    DurableObject -->|"Saved resume text"| Worker
    Worker -->|"Final result"| Browser
    Browser -->|"Resume analysis view"| User
```

The diagram keeps the product flow at the user-facing level: the browser sends a
PDF to the Worker, Cloudflare AI `toMarkdown` converts it to Markdown, Gemini
streams field tokens like `basic.name = Asuka` back through the Worker, and
the Worker stores the extracted resume text in Cloudflare DurableObject storage.

## Tech Stack Peek Reason

Use the blank `Reason` bullets to write the product or engineering opinion.

### Frontend

- Stack: React, React Router v7, XState, SWR, ArkType, Tailwind CSS, daisyUI
- Reason:

### API

- Stack: Express running inside Cloudflare Workers with `nodejs_compat`
- Reason:

### Storage

- Stack: SQLite-backed Durable Objects for resume registry, resume documents,
  and JD records
- Reason:

### Async Jobs

- Stack: Cloudflare Queues for background resume analysis retries
- Reason:

### LLM Interaction

- Stack: Workers AI `toMarkdown`, AI Gateway, Google AI Studio Gemini streaming,
  custom stream-token parsing algorithm
- Reason:

### Validation and Tests

- Stack: ArkType schemas, Vitest integration/browser/Workers tests, Playwright
  e2e entrypoint, Oxlint, Prettier
- Reason:

## Streaming Resume Shape

Resume extraction does not ask the model to stream one giant JSON object. The
prompt asks Gemini to emit independent XML-style field tags such as
`<basic.name>Asuka</basic.name>` and
`<project.0.name>Resume Analyzer</project.0.name>`. Each tag is a flat field
path plus a value.

`src/shared/resumeStream.ts` is the core abstraction:

- `ResumeFieldTagParser` reads model text chunk by chunk and only emits a token
  after a complete matching tag arrives, even when the tag crosses stream
  boundaries.
- `createResumeFieldToken` turns a path into a nested patch. For example,
  `edu.1.school` becomes `{ edu: [undefined, { school: "..." }] }`.
- `mergeResumeTokenPatch` and `collectResumeFieldTokens` make token order
  independent, while numeric path segments rebuild sparse arrays.
- `resumeFromTokenPatch` compacts the patch and returns the final nested
  `ResumeAnalysis` object that the UI and storage layer expect.

The backend streams Server-Sent Events from
`/api/resumes/analyze/stream`: `status` events drive progress UI, `token` events
carry `path`, `value`, and `patch` for incremental reconstruction, and the
`complete` event carries the persisted `resumeId` plus the normalized nested
resume. The current frontend preview displays the streamed path/value tokens,
then routes to the detail page after completion; because the token patch format
is shared, the same stream can also reconstruct the final nested resume object
incrementally on the client.

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
