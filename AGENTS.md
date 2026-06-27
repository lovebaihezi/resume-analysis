# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command | Purpose |
|---------|---------|
| `npx wrangler dev` | Local development |
| `npx wrangler deploy` | Deploy to Cloudflare |
| `npx wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Testing Conventions

- Prefer Cloudflare's Vitest integration for Worker, Durable Object, Queue, and binding behavior because it provides isolated per-test storage. Use deployed E2E only for flows that must prove the real deployed app works.
- Tests that read JSON API responses must validate successful response bodies with the shared ArkType parsers in `src/shared/schemas.ts`; do not add ad hoc `readXFromJson` helpers, direct response-body shape checks, or `JSON.parse(...) as SomeType` casts when a shared parser exists or should be added.
- Deployed E2E tests run against persistent production Durable Object storage. Any test that uploads a resume must capture or recover the created `resumeId`, exercise archive/delete cleanup in the feature flow when relevant, and keep a `finally` cleanup fallback so fixture rows such as `Ava Chen` are not left in `/api/resumes`.
- Treat `pnpm run test:real-ai` as a remote/live-data test. Do not add it to routine validation unless the task explicitly requires it, and add cleanup before introducing any new writes through remote bindings.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Best Practices (conditional)

If the application uses Durable Objects or Workflows, refer to the relevant best practices:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
